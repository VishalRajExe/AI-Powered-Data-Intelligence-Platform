"""Research graph state and execution budget.

Ported from `data-enrichment-js-main/src/enrichment_agent/state.ts` and
`configuration.ts`, with three deliberate changes:

* `messages` is a typed transcript rather than LangChain `BaseMessage` objects, because
  this service has no agent-framework dependency (decision L2).
* `info` (one record) becomes `records` — the platform produces datasets, so the graph
  returns a batch, and `expected_records` lets the critique demand more.
* `sources` and the step budget are added. The template tracked no provenance at all and
  bounded only one of its exit paths; both are requirements here.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any


@dataclass(slots=True)
class ResearchLimits:
    max_loops: int = 6
    max_search_results: int = 5
    max_searches_per_run: int = 8
    max_scrapes_per_run: int = 12
    expected_records: int | None = None
    allowed_domains: list[str] = field(default_factory=list)
    blocked_domains: list[str] = field(default_factory=list)
    model_id: str | None = None


@dataclass(slots=True)
class Message:
    role: str  # "user" | "assistant" | "tool"
    content: str
    name: str | None = None
    status: str = "success"  # "success" | "error"

    def as_dict(self) -> dict[str, Any]:
        return {"role": self.role, "content": self.content, "name": self.name, "status": self.status}


@dataclass(slots=True)
class SourceObserved:
    """A URL this run actually fetched or was returned by search.

    `verified_by_tool` is the rule ported from the old project's
    `AgentResultNormalizer.ts:41-49`: a URL counts as evidence only if a tool returned
    it during this run. A URL the model merely mentions is recorded as unverified.
    """

    url: str
    title: str = ""
    snippet: str = ""
    source_type: str = "search"
    retrieved_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    verified_by_tool: bool = True

    def as_dict(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "title": self.title,
            "snippet": self.snippet,
            "sourceType": self.source_type,
            "retrievedAt": self.retrieved_at,
            "verifiedByTool": self.verified_by_tool,
        }


@dataclass(slots=True)
class StepBudget:
    """Every bound the graph respects, checked on every path.

    In `data-enrichment-js` the loop cap lived only in the post-critique router, so a
    run that kept calling search never encountered it. Here the budget gates the model
    turn, each search and each scrape independently.
    """

    max_loops: int
    max_searches: int
    max_scrapes: int

    loops_used: int = 0
    searches_used: int = 0
    scrapes_used: int = 0

    def note_loop(self) -> None:
        self.loops_used += 1

    def note_search(self, count: int = 1) -> None:
        self.searches_used += count

    def note_scrape(self, count: int = 1) -> None:
        self.scrapes_used += count

    def model_allowed(self) -> bool:
        return self.loops_used < self.max_loops

    def search_allowed(self) -> bool:
        return self.searches_used < self.max_searches

    def scrape_allowed(self) -> bool:
        return self.scrapes_used < self.max_scrapes

    def exhausted_reason(self) -> str | None:
        if self.loops_used >= self.max_loops:
            return f"research loop reached its bound of {self.max_loops} iterations"
        if self.searches_used >= self.max_searches:
            return f"search budget exhausted ({self.max_searches} searches)"
        if self.scrapes_used >= self.max_scrapes:
            return f"scrape budget exhausted ({self.max_scrapes} pages)"
        return None


@dataclass(slots=True)
class ResearchState:
    topic: str
    extraction_schema: dict[str, Any]
    limits: ResearchLimits
    messages: list[Message] = field(default_factory=list)
    records: list[dict[str, Any]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    sources: dict[str, SourceObserved] = field(default_factory=dict)
    feedback: str | None = None
    submitted: dict[str, Any] | None = None
    repair_attempts: int = 0
    tool_errors: list[str] = field(default_factory=list)

    budget: StepBudget = field(default=None)  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.budget is None:
            self.budget = StepBudget(
                max_loops=self.limits.max_loops,
                max_searches=self.limits.max_searches_per_run,
                max_scrapes=self.limits.max_scrapes_per_run,
            )

    def add(self, message: Message) -> None:
        self.messages.append(message)

    def observe(self, url: str, *, title: str = "", snippet: str = "", source_type: str) -> SourceObserved:
        existing = self.sources.get(url)
        if existing is not None:
            if title and not existing.title:
                existing.title = title
            if snippet and not existing.snippet:
                existing.snippet = snippet
            if source_type == "scrape":
                # A searched-then-read URL is stronger evidence than a search hit alone.
                existing.source_type = "search+scrape"
            return existing
        source = SourceObserved(url=url, title=title, snippet=snippet, source_type=source_type)
        self.sources[url] = source
        return source

    def observed_urls(self) -> set[str]:
        return set(self.sources)

    def has_tool_data(self) -> bool:
        """Gate 2's precondition: at least one data tool returned something."""
        return any(message.status == "success" and message.content.strip() for message in self.messages
                   if message.role == "tool")
