"""One source policy, asked one question: may this URL be fetched?

Domain allow/block came from `data-enrichment-js`'s lack of any such gate plus the old project's
`FirecrawlAgentAdapter.ts:242-309`, which enforced policy *inside* the agent adapter — so an
agent could be constructed without it. Robots came from `web-research-agent-master`. They were
two separate checks in two layers; here they are one decision path, because a scrape should not
be able to pass one and skip the other.

Every refusal returns a reason that reaches the run's output. Upstream's scraper logs a warning
and drops the URL (`web_scraper_tool.py:10,22`), leaving a caller unable to tell "the site says
no" from "we never tried".
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

from app.curation.robots import RobotsGate

# A label of 2+ alphanumeric characters separated by dots, with a last label of at least two so
# `a.b` is not mistaken for a registrable domain. Deliberately not a full domain grammar: this
# only decides whether a free-text preference looks like a hostname at all, and a token that
# fails it is reported as a note instead of silently becoming a rule.
_HOSTISH = re.compile(r"^[a-z0-9]([a-z0-9\-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]*[a-z0-9])?)+$")
_TLD_MIN_LENGTH = 2


@dataclass(frozen=True, slots=True)
class PolicyDecision:
    allowed: bool
    code: str
    reason: str | None = None

    def as_dict(self) -> dict[str, object]:
        return {"allowed": self.allowed, "code": self.code, "reason": self.reason}


def host_of(url: str) -> str:
    try:
        return (urlparse(url).netloc or "").lower().split("@")[-1].split(":")[0]
    except ValueError:
        return ""


def domain_allowed(url: str, allowed: list[str], blocked: list[str]) -> bool:
    """Exact-host or subdomain match, with the block list winning over the allow list.

    `blocked` is checked first on purpose: an explicit denial must not be bypassed by a broader
    allow entry that happens to cover the same host.
    """
    host = host_of(url)
    if not host:
        return False
    root = host.removeprefix("www.")
    if any(root == blocked_host or root.endswith("." + blocked_host)
           for blocked_host in (d.lower() for d in blocked if d)):
        return False
    if allowed:
        return any(root == allowed_host or root.endswith("." + allowed_host)
                   for allowed_host in (d.lower() for d in allowed if d))
    return True


def extract_hostnames(values: list[str]) -> tuple[list[str], list[str]]:
    """Pull host-shaped tokens out of free-text source wishes.

    A requirement's `sourcePreferences` arrives as whatever the model wrote: it may be
    `example.com`, `https://example.com/pricing`, or "the company's own website". Only the
    host-shaped ones become a policy; the rest come back as *notes* so nothing is silently
    converted into a domain the user never named — and a prose preference that cannot be
    enforced is still visible in the result.
    """
    hosts: list[str] = []
    notes: list[str] = []

    for value in values:
        text = (value or "").strip()
        if not text:
            continue

        # Split on list separators only. A comma can mean two sources; a space almost always
        # means one phrase that is not a hostname at all ("the company's own website"), and
        # chopping that into words would produce notes nobody can read.
        for part in (chunk.strip() for chunk in re.split(r"[,;]+", text)):
            if not part:
                continue
            candidate = part.lower().split("://")[-1].split("/")[0].split(":")[0].split()[0]
            last_label = candidate.rsplit(".", 1)[-1] if "." in candidate else ""
            if _HOSTISH.match(candidate) and len(last_label) >= _TLD_MIN_LENGTH:
                if candidate not in hosts:
                    hosts.append(candidate)
            elif part not in notes:
                notes.append(part)

    return hosts, notes


class SourcePolicy:
    """Per-run, because the limits are per-run: domains, robots gate, and what this run has
    already read."""

    def __init__(self, *, allowed_domains: list[str] | None = None,
                 blocked_domains: list[str] | None = None,
                 robots: RobotsGate | None = None) -> None:
        self._allowed = [d.lower() for d in (allowed_domains or []) if d]
        self._blocked = [d.lower() for d in (blocked_domains or []) if d]
        self._robots = robots

    def check_domain(self, url: str) -> PolicyDecision:
        host = host_of(url)
        if not host:
            return PolicyDecision(False, "no-host", "url has no host to evaluate")
        if not domain_allowed(url, self._allowed, self._blocked):
            reason = (f"{host} is on this run's block list" if any(
                host == blocked or host.endswith("." + blocked) for blocked in self._blocked)
                else f"{host} is outside this run's allowed domains: {', '.join(self._allowed)}")
            return PolicyDecision(False, "domain-policy", reason)
        return PolicyDecision(True, "domain-policy")

    async def check_fetch(self, url: str) -> PolicyDecision:
        domain = self.check_domain(url)
        if not domain.allowed:
            return domain
        if self._robots is None:
            return PolicyDecision(True, "robots-skipped", "no robots gate configured for this run")

        decision = await self._robots.check(url)
        if decision.allowed:
            return PolicyDecision(True, "robots", decision.reason)
        return PolicyDecision(False, f"robots-{decision.state}", decision.reason)
