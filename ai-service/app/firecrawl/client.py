"""Firecrawl is the only web engine in this project.

The single place our code meets the Firecrawl SDK, in the spirit of
`web-agent-main/agent-core/src/toolkit.ts`: one seam, per-tool timeouts, a concurrency
cap, and normalised results. The research graph depends on :class:`WebTool`, never on
this module, which is what lets it be tested without a network or an API key.

Three tools live here: `search`, `scrape` and `interact`. `interact` is the only one that
acts on a page instead of reading it, so it carries its own concurrency cap, its own hard
deadline and an explicit browser-session lifecycle, and it stays disabled until an
operator lists it in `ALLOWED_WEB_TOOLS`.

Replaced on the way in: `data-enrichment-js` searched with Tavily and scraped with a
bare ``fetch`` that never inspected ``response.ok``; ``ai-data-enrichment-agent``
scraped with a Bright Data unlocker its own comment calls an anti-bot bypass. Both are
rejected in `docs/audit/O-new-repositories-integration-analysis.md` §O.5.

Scope note: this client guards URL *shape* and scheme only, because the model chooses
URLs. Robots policy, SSRF host resolution, per-domain rate limiting and allow-list
enforcement belong to Spring, which must clear a URL before it reaches this service
(`docs/audit/A-final-architecture.md` §A.2). That gating is the source-governance phase.
Nothing here bypasses a login wall, CAPTCHA or paywall: a session that meets one is
reported as an error and the run moves on.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import urlparse

from app.config import Settings

logger = logging.getLogger("finalagent.firecrawl")


class WebError(RuntimeError):
    """A web tool failed. Reported as a tool error, never swallowed into empty data."""


@dataclass(slots=True)
class SearchHit:
    url: str
    title: str = ""
    snippet: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {"url": self.url, "title": self.title, "snippet": self.snippet}


@dataclass(slots=True)
class Page:
    url: str
    title: str = ""
    markdown: str = ""
    status_code: int | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "title": self.title,
            "markdown": self.markdown,
            "statusCode": self.status_code,
        }


@dataclass(slots=True)
class Interaction:
    """The result of one Firecrawl browser-session turn.

    Modelled on `BrowserExecuteResponse` (`output/result/stdout/stderr/exitCode/killed/
    truncated`). `output` is what prompt mode puts the natural-language answer in.

    A timeout is data, not an exception: upstream resolves a structured envelope instead
    of hanging the loop (`toolkit.ts:77-91`), and the graph needs to be able to tell the
    model to fall back to `scrape`, which it can only do if the refusal is content.
    """

    url: str
    prompt: str
    output: str = ""
    error: str | None = None
    timed_out: bool = False
    session_id: str | None = None
    truncated: bool | None = None
    killed: bool | None = None
    fields: dict[str, Any] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.error is None and bool(self.output.strip())

    def as_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "url": self.url,
            "prompt": self.prompt,
            "output": self.output,
            "timedOut": self.timed_out,
        }
        if self.session_id:
            payload["sessionId"] = self.session_id
        if self.error:
            payload["error"] = self.error
        if self.truncated is not None:
            payload["truncated"] = self.truncated
        if self.killed is not None:
            payload["killed"] = self.killed
        if self.fields:
            payload["fields"] = self.fields
        return payload


class WebTool(Protocol):
    async def search(self, query: str, limit: int) -> list[SearchHit]: ...

    async def scrape(self, url: str) -> Page: ...


class InteractiveWebTool(WebTool, Protocol):
    """`interact` is optional capability, not a baseline: a web engine that cannot run a
    browser session must still satisfy every other part of the contract."""

    async def interact(self, url: str, prompt: str) -> Interaction: ...


def supports_interact(web: WebTool) -> bool:
    return callable(getattr(web, "interact", None))



def validated_http_url(url: str) -> str:
    """Reject anything that is not an absolute http(s) URL before it leaves the process."""
    candidate = (url or "").strip()
    if not candidate:
        raise WebError("empty URL")
    try:
        parsed = urlparse(candidate)
    except ValueError as exc:
        raise WebError(f"unparseable URL: {candidate!r}") from exc
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        # A model inventing `file://` or `data:` URLs is a real failure mode when the
        # graph is allowed to name its own targets.
        raise WebError(f"refused non-http(s) URL scheme: {parsed.scheme or 'none'!r}")
    return candidate


def _payload(data: Any) -> Any:
    """Unwrap the SDK's response envelope without assuming which shape it used."""
    for attribute in ("data", "content", "web"):
        inner = getattr(data, attribute, None)
        if inner is not None and not isinstance(inner, (str, int, float, bool)):
            return inner
    return data


def normalize_search(data: Any, limit: int) -> list[SearchHit]:
    """`SearchData` keeps ranked results under `.web`; fall back to a bare list."""
    payload = _payload(data)
    web = getattr(payload, "web", None)
    if web is None and isinstance(payload, dict):
        web = payload.get("web")
    candidates = web if web is not None else payload
    if not isinstance(candidates, list):
        return []

    hits: list[SearchHit] = []
    for item in candidates[:limit]:
        def read(*names: str) -> Any:
            for name in names:
                value = getattr(item, name, None)
                if value is None and isinstance(item, dict):
                    value = item.get(name)
                if value is not None:
                    return value
            return ""

        url = read("url")
        if not url:
            continue
        hits.append(SearchHit(url=str(url), title=str(read("title") or ""),
                              snippet=str(read("description", "snippet") or "")))
    return hits


def normalize_page(data: Any, *, fallback_url: str, truncate_chars: int) -> Page:
    payload = _payload(data)
    metadata = getattr(payload, "metadata", None)

    def read(*names: str) -> Any:
        for source in (payload, metadata):
            if source is None:
                continue
            for name in names:
                value = getattr(source, name, None)
                if value is None and isinstance(source, dict):
                    value = source.get(name)
                if value is not None:
                    return value
        return None

    markdown = str(read("markdown") or "")
    truncated = markdown[:truncate_chars]
    if len(markdown) > truncate_chars:
        # Marking the cut is the difference between a short page and a silently
        # amputated one; an unmarked truncation misleads the model and the reader.
        truncated += "\n\n[... content truncated by the collection layer ...]"

    status = read("status_code", "statusCode")
    return Page(
        url=str(read("url") or fallback_url),
        title=str(read("title") or ""),
        markdown=truncated,
        status_code=int(status) if status is not None else None,
    )


def _field(source: Any, *names: str) -> Any:
    """Read the first present attribute or dict key, without assuming the SDK's style."""
    for name in names:
        value = getattr(source, name, None)
        if value is None and isinstance(source, dict):
            value = source.get(name)
        if value is not None:
            return value
    return None


def strip_interact_nulls(result: Any) -> Any:
    """Drop top-level null/empty-string fields from an interact result.

    Direct port of `toolkit.ts:25-34`. Firecrawl's `/interact` always returns the whole
    response shape and fills only the fields that apply to the mode used, so a prompt-mode
    answer comes back with `result`, `stdout`, `stderr` and `exitCode` null. A model that
    sees those echoes `null` straight into its reply. Empty arrays and objects are kept —
    `links: []` is the claim that there were none, which is information.
    """
    if not isinstance(result, dict):
        return result
    return {
        key: value
        for key, value in result.items()
        if value is not None and not (isinstance(value, str) and value == "")
    }


def interact_timeout_message(timeout_seconds: float) -> str:
    """Upstream's timeout text (`toolkit.ts:84`), reworded for our tool names.

    The advice in it is the point: the model needs to know which fallback to take, or it
    retries the same browser prompt until the interaction budget runs out.
    """
    return (
        f"interact timed out after {timeout_seconds}s; the browser session did not return. "
        "Try a simpler prompt, split it into smaller steps, or fall back to scrape."
    )


def _as_dict(payload: Any) -> dict[str, Any]:
    """A dict view of an SDK response, however it was modelled."""
    if isinstance(payload, dict):
        return dict(payload)
    dump = getattr(payload, "model_dump", None)
    if callable(dump):
        try:
            return dict(dump(exclude_none=False))
        except (TypeError, ValueError):
            return {}
    fields = getattr(payload, "__dict__", None)
    return {k: v for k, v in fields.items() if not k.startswith("_")} if isinstance(fields, dict) else {}


def _flag(value: Any) -> bool | None:
    return None if value is None else bool(value)


def normalize_interact(data: Any, *, url: str, prompt: str, session_id: str | None,
                       truncate_chars: int) -> Interaction:
    payload = _payload(data)
    error = _field(payload, "error")
    output = _field(payload, "output", "stdout", "result", "text")
    if isinstance(output, (dict, list)):
        import json

        output = json.dumps(output, ensure_ascii=False)
    text = str(output or "")
    if len(text) > truncate_chars:
        text = text[:truncate_chars] + "\n[... interact output truncated by the collection layer ...]"

    return Interaction(
        url=str(_field(payload, "url") or url),
        prompt=prompt,
        output=text,
        error=str(error) if error else None,
        session_id=session_id,
        truncated=_flag(_field(payload, "truncated")),
        killed=_flag(_field(payload, "killed")),
        fields=strip_interact_nulls(_as_dict(payload)),
    )


class FirecrawlWeb:
    def __init__(self, settings: Settings, *, app: Any | None = None) -> None:
        if app is None:
            from firecrawl import AsyncFirecrawlApp

            app = AsyncFirecrawlApp(api_key=settings.firecrawl_api_key,
                                    api_url=settings.firecrawl_base_url)

        self._settings = settings
        self._app = app
        self._semaphore = asyncio.Semaphore(settings.max_collect_concurrency)
        self._interact_semaphore = asyncio.Semaphore(settings.max_interact_concurrency)

    async def search(self, query: str, limit: int) -> list[SearchHit]:
        data = await self._call(
            "search",
            self._app.search(query, limit=limit),
            timeout=self._settings.search_timeout_seconds,
        )
        return normalize_search(data, limit)

    async def scrape(self, url: str) -> Page:
        target = validated_http_url(url)
        data = await self._call(
            "scrape",
            self._app.scrape(target, formats=["markdown"]),
            timeout=self._settings.scrape_timeout_seconds,
        )
        return normalize_page(data, fallback_url=target, truncate_chars=self._settings.markdown_truncate_chars)

    async def interact(self, url: str, prompt: str) -> Interaction:
        """One browser session per call, created and destroyed inside it.

        `agent-core` inherits session lifecycle from `firecrawl-aisdk` and only wraps the
        call with a deadline (`toolkit.ts:51-102`). The Python SDK exposes the lifecycle,
        so it is owned here: `browser()` → `interact()` → `stop_interaction()` in a
        `finally`. Upstream's abort leaves the session to expire on its own TTL; a session
        we abandon would keep billing credits for the rest of `ttl`, so the stop always
        runs, including on the timeout path.
        """
        target = validated_http_url(url)
        if not prompt.strip():
            raise WebError("interact requires a prompt")

        timeout = self._settings.interact_timeout_seconds
        async with self._interact_semaphore:
            try:
                created = await asyncio.wait_for(self._app.browser(), timeout=timeout)
            except asyncio.TimeoutError as exc:
                raise WebError(f"browser creation timed out after {timeout}s") from exc
            except WebError:
                raise
            except Exception as exc:
                raise WebError(f"browser creation failed: {type(exc).__name__}") from exc

            session_id = _field(created, "id", "session_id", "sessionId")
            if not session_id:
                raise WebError("Firecrawl returned a browser session with no id")

            try:
                executed = await asyncio.wait_for(
                    self._app.interact(str(session_id), prompt=prompt, timeout=int(timeout)),
                    timeout=timeout,
                )
            except asyncio.TimeoutError:
                # Returned, not raised: the graph reports this to the model as tool output
                # with guidance, and a raised WebError would carry none of that.
                return Interaction(url=target, prompt=prompt, session_id=str(session_id),
                                   timed_out=True, error=interact_timeout_message(timeout))
            except WebError:
                raise
            except Exception as exc:
                raise WebError(f"interact failed: {type(exc).__name__}") from exc
            finally:
                await self._stop_session(str(session_id))

            return normalize_interact(
                executed,
                url=target,
                prompt=prompt,
                session_id=str(session_id),
                truncate_chars=self._settings.markdown_truncate_chars,
            )

    async def _stop_session(self, session_id: str) -> None:
        """Close the session. A failure here is logged, never raised: it must not replace
        the error or result the caller is about to act on."""
        stop = getattr(self._app, "stop_interaction", None) or getattr(self._app, "stop_interactive_browser", None)
        if stop is None:
            logger.warning("firecrawl SDK exposes no session-stop method; session %s will expire on TTL", session_id)
            return
        try:
            await stop(session_id)
        except Exception as exc:
            logger.warning("could not close browser session %s: %s", session_id, type(exc).__name__)

    async def _call(self, tool: str, awaitable: Any, *, timeout: float) -> Any:
        async with self._semaphore:
            try:
                return await asyncio.wait_for(awaitable, timeout=timeout)
            except asyncio.TimeoutError as exc:
                raise WebError(f"{tool} timed out after {timeout}s") from exc
            except WebError:
                raise
            except Exception as exc:
                # Type name only: SDK exceptions can echo request data, which carries
                # the API key.
                raise WebError(f"{tool} failed: {type(exc).__name__}") from exc



class FakeWeb:
    """Test double: scripted search/scrape, with call accounting for assertions.

    Deliberately has **no** `interact` method. That makes "this web engine cannot run a
    browser session" a state the graph can be tested against rather than an assumption."""

    def __init__(
        self,
        *,
        search_results: list[list[SearchHit]] | None = None,
        pages: dict[str, Page] | None = None,
        fail_urls: set[str] | None = None,
    ) -> None:
        self._search_results = search_results or [[]]
        self._pages = pages or {}
        self._fail_urls = fail_urls or set()
        self.search_calls: list[str] = []
        self.scrape_calls: list[str] = []

    async def search(self, query: str, limit: int) -> list[SearchHit]:
        self.search_calls.append(query)
        index = min(len(self.search_calls) - 1, len(self._search_results) - 1)
        return self._search_results[index][:limit]

    async def scrape(self, url: str) -> Page:
        self.scrape_calls.append(url)
        validated_http_url(url)
        if url in self._fail_urls:
            raise WebError(f"scrape refused for {url}")
        page = self._pages.get(url)
        if page is None:
            return Page(url=url, title=f"Page {url}", markdown=f"markdown body for {url}")
        return page


class FakeInteractiveWeb(FakeWeb):
    """A web engine that can also run a browser session, scripted per URL.

    Separate from :class:`FakeWeb` so that the presence of `interact` is something a test
    chooses, matching how the real capability is opt-in through `ALLOWED_WEB_TOOLS`.
    """

    def __init__(
        self,
        *,
        interactions: dict[str, Interaction] | None = None,
        fail_interact_urls: set[str] | None = None,
        default_output: str = "browser session answered",
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._interactions = interactions or {}
        self._fail_interact_urls = fail_interact_urls or set()
        self._default_output = default_output
        self.interact_calls: list[tuple[str, str]] = []

    async def interact(self, url: str, prompt: str) -> Interaction:
        self.interact_calls.append((url, prompt))
        validated_http_url(url)
        if not prompt.strip():
            raise WebError("interact requires a prompt")
        if url in self._fail_interact_urls:
            raise WebError(f"interact refused for {url}")
        scripted = self._interactions.get(url)
        if scripted is not None:
            return scripted
        return Interaction(
            url=url,
            prompt=prompt,
            output=f"{self._default_output} for {url}",
            session_id="fake-session",
        )
