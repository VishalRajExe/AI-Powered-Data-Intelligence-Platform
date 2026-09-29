"""robots.txt: what the site asked us not to fetch.

Ported from `web-research-agent-master/utils/web_scraper.py:18-31` (`allowed_to_scrape`), which
is genuinely wired into its fetch path (`web_scraper_tool.py:9`) — unlike several other things
in that repo — but has three behaviours this version fixes:

* **One robots.txt GET per URL, uncached.** A 10-page batch from one host costs 10 extra
  requests to the same origin, which is itself the courtesy problem robots.txt exists to manage.
  Fetched once per origin per run, behind a lock so concurrent scrapes do not stampede it.
* **`can_fetch("*", url)`** — a literal `*` user agent. A real crawler should ask about its own
  token, because sites restrict specific ones. `ROBOTS_USER_AGENT` is what we ask about, and it
  is also the token we would identify ourselves with.
* **No status check before parsing.** `resp.text` of a 401 or a 500 error page is fed to
  `robotparser`, which finds no rules and answers "allowed" — so an unreachable robots.txt
  silently becomes permission. Here 401/403/404 mean "no rules" (RFC 9309 §2.3.1), and 5xx or a
  network failure means *unknown*, which `ROBOTS_ON_ERROR` decides: `restrict` (default) refuses
  the source and says why; `allow` fetches it and marks the run as having proceeded without a
  readable policy. Neither is silent.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Literal, Protocol
from urllib import robotparser
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

logger = logging.getLogger("finalagent.robots")

RobotsState = Literal["allowed", "no-rules", "restricted", "unreachable", "disabled", "invalid-url"]

_ROBOTS_FETCH_LIMIT = 65_536  # bytes; a robots file that is bigger than this is not worth reading
_IGNORED_ERROR_STATUSES = frozenset({401, 403, 404, 405})


@dataclass(frozen=True, slots=True)
class RobotsDecision:
    allowed: bool
    state: RobotsState
    reason: str | None = None

    def as_dict(self) -> dict[str, object]:
        return {"allowed": self.allowed, "state": self.state, "reason": self.reason}


class RobotsGate(Protocol):
    async def check(self, url: str) -> RobotsDecision: ...


def _origin(url: str) -> tuple[str, str] | None:
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return None
    return parts.scheme, parts.netloc


def parse_decision(text: str, user_agent: str, url: str) -> RobotsDecision:
    if not (text or "").strip():
        return RobotsDecision(True, "no-rules")
    parser = robotparser.RobotFileParser()
    parser.parse(text.splitlines())
    if parser.can_fetch(user_agent, url):
        return RobotsDecision(True, "allowed")
    return RobotsDecision(False, "restricted",
                          reason=f"robots.txt for {urlsplit(url).netloc} disallows {url} for "
                                 f"user-agent {user_agent!r}")


class HttpRobots:
    """stdlib-only fetcher: no new HTTP dependency, one file per origin, bounded by a timeout."""

    def __init__(self, *, user_agent: str, timeout_seconds: float, on_error: str = "restrict",
                 enabled: bool = True) -> None:
        self._user_agent = user_agent
        self._timeout = timeout_seconds
        self._on_error = on_error
        self._enabled = enabled
        # The *file* is cached per origin, not the verdict: `/a` and `/b/nope` on the same host
        # have different answers, and caching one as the other would either block a page the
        # site permits or fetch one it forbids.
        self._files: dict[tuple[str, str], str] = {}
        self._failures: dict[tuple[str, str], RobotsDecision] = {}
        self._locks: dict[tuple[str, str], asyncio.Lock] = {}
        self.fetches = 0

    async def check(self, url: str) -> RobotsDecision:
        if not self._enabled:
            return RobotsDecision(True, "disabled")
        origin = _origin(url)
        if origin is None:
            return RobotsDecision(False, "invalid-url", reason="not an absolute http(s) URL")

        text, failure = await self._origin_state(origin)
        if failure is not None:
            return failure
        return parse_decision(text, self._user_agent, url)

    async def _origin_state(self, origin: tuple[str, str]) -> tuple[str, RobotsDecision | None]:
        if origin in self._files:
            return self._files[origin], None
        if origin in self._failures:
            return "", self._failures[origin]

        lock = self._locks.setdefault(origin, asyncio.Lock())
        async with lock:
            if origin in self._files:
                return self._files[origin], None
            if origin in self._failures:
                return "", self._failures[origin]

            try:
                text, failure = await self._fetch(origin)
            except Exception as exc:  # noqa: BLE001 - `_fetch` should not raise; if it does, that is "unknown"
                text, failure = None, f"{type(exc).__name__}: {str(exc)[:120]}"

            if failure is not None:
                decision = self._failure_decision(origin, failure)
                self._failures[origin] = decision
                return "", decision

            # A status we deliberately treat as "no usable file" is an absence of rules, not a
            # permission slip: recorded as an empty file so the reason is stable all run.
            body = text if text is not None else ""
            self._files[origin] = body
            return body, None

    def _failure_decision(self, origin: tuple[str, str], failure: str) -> RobotsDecision:
        restrict = self._on_error == "restrict"
        return RobotsDecision(
            not restrict,
            "unreachable",
            reason=f"robots.txt for {origin[1]} could not be read ({failure}); "
                   + ("the source is refused rather than fetched blind" if restrict else
                      "proceeding without a readable policy"),
        )

    async def _fetch(self, origin: tuple[str, str]) -> tuple[str | None, str | None]:
        scheme, netloc = origin
        url = f"{scheme}://{netloc}/robots.txt"
        self.fetches += 1
        try:
            body = await asyncio.to_thread(self._read_blocking, url)
            return body, None
        except HTTPError as exc:
            if exc.code in _IGNORED_ERROR_STATUSES:
                return None, None  # no usable robots file: treat as no rules
            return None, f"HTTP {exc.code}"
        except (URLError, TimeoutError, OSError, ValueError) as exc:
            # Type plus text: a socket error text never contains credentials, and "why" is the
            # whole message here.
            return None, f"{type(exc).__name__}: {str(exc)[:120]}"

    def _read_blocking(self, url: str) -> str:
        request = Request(url, headers={"User-Agent": self._user_agent, "Accept": "text/plain"})
        with urlopen(request, timeout=self._timeout) as response:  # noqa: S310 - https/http only, host from the URL being gated
            return response.read(_ROBOTS_FETCH_LIMIT).decode("utf-8", errors="replace")


class StaticRobots:
    """Test double: per-URL decisions plus failure injection, and a fetch count."""

    def __init__(self, *, rules: dict[str, RobotsDecision] | None = None,
                 default: RobotsDecision | None = None, error_urls: set[str] | None = None) -> None:
        self._rules = rules or {}
        self._default = default or RobotsDecision(True, "no-rules")
        self._errors = error_urls or set()
        self.checked: list[str] = []

    async def check(self, url: str) -> RobotsDecision:
        self.checked.append(url)
        if url in self._errors:
            return RobotsDecision(False, "unreachable", reason="robots.txt could not be read")
        return self._rules.get(url, self._default)


def build_robots_gate(settings) -> RobotsGate:
    return HttpRobots(
        user_agent=settings.robots_user_agent,
        timeout_seconds=settings.robots_timeout_seconds,
        on_error=settings.robots_on_error,
        enabled=settings.robots_enabled,
    )
