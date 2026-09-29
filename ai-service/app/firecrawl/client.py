"""Firecrawl is the only web engine in this project.

The single place our code meets the Firecrawl SDK, in the spirit of
`web-agent-main/agent-core/src/toolkit.ts`: one seam, per-tool timeouts, a concurrency
cap, and normalised results. The research graph depends on :class:`WebTool`, never on
this module, which is what lets it be tested without a network or an API key.

Replaced on the way in: `data-enrichment-js` searched with Tavily and scraped with a
bare ``fetch`` that never inspected ``response.ok``; ``ai-data-enrichment-agent``
scraped with a Bright Data unlocker its own comment calls an anti-bot bypass. Both are
rejected in `docs/audit/O-new-repositories-integration-analysis.md` §O.5.

Scope note: this client guards URL *shape* and scheme only, because the model chooses
URLs. Robots policy, SSRF host resolution, per-domain rate limiting and allow-list
enforcement belong to Spring, which must clear a URL before it reaches this service
(`docs/audit/A-final-architecture.md` §A.2). That gating is the source-governance phase.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlparse

from app.config import Settings


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


class WebTool(Protocol):
    async def search(self, query: str, limit: int) -> list[SearchHit]: ...

    async def scrape(self, url: str) -> Page: ...


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


class FirecrawlWeb:
    def __init__(self, settings: Settings) -> None:
        from firecrawl import AsyncFirecrawlApp

        self._settings = settings
        self._app = AsyncFirecrawlApp(api_key=settings.firecrawl_api_key, api_url=settings.firecrawl_base_url)
        self._semaphore = asyncio.Semaphore(settings.max_collect_concurrency)

    async def search(self, query: str, limit: int) -> list[SearchHit]:
        data = await self._call(
            "search",
            self._app.search(query, limit=limit),
            timeout=self._settings.interact_timeout_seconds,
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
    """Test double: scripted search/scrape, with call accounting for assertions."""

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
