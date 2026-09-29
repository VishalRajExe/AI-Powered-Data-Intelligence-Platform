"""Tool execution for the research graph.

Port of `data-enrichment-js/src/enrichment_agent/tools.ts`, with its two web paths
replaced by Firecrawl and four of its defects closed:

* Search was Tavily (`tools.ts:39-42`) and scraping was a bare `await fetch(url)`
  (`tools.ts:44-70`); both are gone — one web engine, per the integration analysis.
* Their scraper never checked `response.ok`, so a 404 or a bot-block page was handed to
  the model as content and later cited as evidence. A non-2xx status or an empty body is
  now an error outcome.
* They deduplicated nothing, so the same URL could be re-scraped until the budget ran
  out. Repeat URLs are refused here.
* They injected `__state` into every tool's arguments (`tools.ts:108-114`) while their
  own tool schema declared `additionalProperties: false`, and nothing read it. Not
  reproduced.

Per-call error isolation and concurrent execution from their `toolNode` are kept: one bad
URL must not abort a run.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from urllib.parse import urlparse

from app.firecrawl.client import Page, SearchHit, WebError, WebTool, validated_http_url
from app.research.state import ResearchState


@dataclass(slots=True)
class ToolOutcome:
    name: str
    ok: bool
    content: str
    observed_urls: list[str] = field(default_factory=list)
    error: str | None = None


def _host(url: str) -> str:
    try:
        return (urlparse(url).netloc or "").lower()
    except ValueError:
        return ""


def domain_allowed(url: str, allowed: list[str], blocked: list[str]) -> bool:
    host = _host(url)
    if not host:
        return False
    root = host.removeprefix("www.")
    if any(root == blocked_host or root.endswith("." + blocked_host) for blocked_host in
           (d.lower() for d in blocked if d)):
        return False
    if allowed:
        return any(root == allowed_host or root.endswith("." + allowed_host) for allowed_host in
                   (d.lower() for d in allowed if d))
    return True


def _format_hits(hits: list[SearchHit]) -> str:
    entries: list[str] = []
    for index, hit in enumerate(hits, start=1):
        entry = f"{index}. {hit.url}"
        if hit.title:
            entry += f"\n   title: {hit.title}"
        if hit.snippet:
            entry += f"\n   snippet: {hit.snippet[:300]}"
        entries.append(entry)
    return "\n\n".join(entries)


def _format_page(page: Page) -> str:
    header = f"URL: {page.url}\nTitle: {page.title}\nHTTP status: {page.status_code}"
    return f"{header}\n\n{page.markdown}".strip()


async def run_search(
    state: ResearchState,
    web: WebTool,
    query: str,
    *,
    include_scraped: set[str] | None = None,
) -> ToolOutcome:
    if not query.strip():
        return ToolOutcome(name="search", ok=False, content="", error="search requires a query")
    if not state.budget.search_allowed():
        return ToolOutcome(
            name="search",
            ok=False,
            content="",
            error=f"search budget exhausted ({state.budget.max_searches})",
        )

    try:
        hits = await web.search(query, limit=state.limits.max_search_results)
    except WebError as exc:
        return ToolOutcome(name="search", ok=False, content="", error=str(exc))

    state.budget.note_search()
    usable = [hit for hit in hits if domain_allowed(hit.url, state.limits.allowed_domains, state.limits.blocked_domains)]

    if not usable:
        return ToolOutcome(
            name="search",
            ok=False,
            content="",
            error="search returned no results that passed the domain policy",
        )

    for hit in usable:
        state.observe(hit.url, title=hit.title, snippet=hit.snippet, source_type="search")

    return ToolOutcome(
        name="search",
        ok=True,
        content=f"Search results for {query!r}:\n\n{_format_hits(usable)}",
        observed_urls=[hit.url for hit in usable],
    )


async def run_scrape(state: ResearchState, web: WebTool, url: str) -> ToolOutcome:
    try:
        target = validated_http_url(url)
    except WebError as exc:
        return ToolOutcome(name="scrape", ok=False, content="", error=str(exc))

    if not state.budget.scrape_allowed():
        return ToolOutcome(
            name="scrape",
            ok=False,
            content="",
            error=f"scrape budget exhausted ({state.budget.max_scrapes})",
        )
    if not domain_allowed(target, state.limits.allowed_domains, state.limits.blocked_domains):
        return ToolOutcome(name="scrape", ok=False, content="", error="url is outside the domain policy")

    already = next((message for message in state.messages
                    if message.name == "scrape" and message.status == "success"
                    and f"URL: {target}" in message.content), None)
    if already is not None:
        return ToolOutcome(name="scrape", ok=False, content="", error=f"already retrieved: {target}")

    try:
        page = await web.scrape(target)
    except WebError as exc:
        return ToolOutcome(name="scrape", ok=False, content="", error=str(exc))

    state.budget.note_scrape()

    if page.status_code is not None and not 200 <= page.status_code < 300:
        return ToolOutcome(
            name="scrape",
            ok=False,
            content="",
            error=f"server returned HTTP {page.status_code} for {target}; its body is not evidence",
        )
    if not page.markdown.strip():
        return ToolOutcome(name="scrape", ok=False, content="", error=f"no readable content at {target}")

    state.observe(target, title=page.title, source_type="scrape")
    return ToolOutcome(
        name="scrape",
        ok=True,
        content=_format_page(page),
        observed_urls=[page.url or target],
    )


async def execute_action(state: ResearchState, web: WebTool, action: dict) -> list[ToolOutcome]:
    """Run the single action the model chose.

    Returns a list for signature parity with the template's concurrent `toolNode`; the
    action schema deliberately permits one action per turn, so cross-turn parallelism
    lives in the collection phase, and the per-request cap stays inside the Firecrawl
    client's semaphore.
    """
    kind = action.get("action")
    if kind == "search":
        return [await run_search(state, web, str(action.get("query", "")))]
    if kind == "scrape":
        return [await run_scrape(state, web, str(action.get("url", "")))]
    return []


async def execute_many(state: ResearchState, web: WebTool, calls: list[tuple[str, str]]) -> list[ToolOutcome]:
    """Concurrent execution with per-call isolation, kept for batch phases."""
    tasks = [
        run_search(state, web, value) if kind == "search" else run_scrape(state, web, value)
        for kind, value in calls
    ]
    return list(await asyncio.gather(*tasks))
