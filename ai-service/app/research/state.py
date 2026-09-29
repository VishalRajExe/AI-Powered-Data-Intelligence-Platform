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
    max_interactions_per_run: int = 0
    expected_records: int | None = None
    allowed_domains: list[str] = field(default_factory=list)
    blocked_domains: list[str] = field(default_factory=list)
    # The web tools this run may use, already intersected with the service ceiling by the
    # caller. Ported from `toolkit.ts:188-204`, where `createFiltered(enabled)` builds the
    # agent's tool set from an allowlist — a tool the model is not shown is one it cannot
    # invent a call for.
    allowed_tools: list[str] = field(default_factory=lambda: ["search", "scrape"])
    # --- curation (Phase 5). All request-derived: nothing here names a domain or an entity. ---
    entity_type: str | None = None
    preferred_domains: list[str] = field(default_factory=list)
    max_sources_per_domain: int = 0
    min_relevance_score: float = 0.0
    max_candidates_per_search: int = 8
    desired_sources: int | None = None
    # Source preferences the user stated that are not hostnames — "the company's own site",
    # "news coverage". They cannot become a domain rule, so they are carried through and
    # reported instead of being quietly dropped or, worse, guessed at.
    source_preference_notes: list[str] = field(default_factory=list)
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
    turn, each search, each scrape and each browser session independently.
    """

    max_loops: int
    max_searches: int
    max_scrapes: int
    max_interactions: int = 0

    loops_used: int = 0
    searches_used: int = 0
    scrapes_used: int = 0
    interactions_used: int = 0

    def note_loop(self) -> None:
        self.loops_used += 1

    def note_search(self, count: int = 1) -> None:
        self.searches_used += count

    def note_scrape(self, count: int = 1) -> None:
        self.scrapes_used += count

    def note_interaction(self, count: int = 1) -> None:
        self.interactions_used += count

    def model_allowed(self) -> bool:
        return self.loops_used < self.max_loops

    def search_allowed(self) -> bool:
        return self.searches_used < self.max_searches

    def scrape_allowed(self) -> bool:
        return self.scrapes_used < self.max_scrapes

    def interaction_allowed(self) -> bool:
        return self.interactions_used < self.max_interactions

    def exhausted_reason(self) -> str | None:
        if self.loops_used >= self.max_loops:
            return f"research loop reached its bound of {self.max_loops} iterations"
        if self.searches_used >= self.max_searches:
            return f"search budget exhausted ({self.max_searches} searches)"
        if self.scrapes_used >= self.max_scrapes:
            return f"scrape budget exhausted ({self.max_scrapes} pages)"
        if self.interactions_used >= self.max_interactions and self.max_interactions:
            return f"interaction budget exhausted ({self.max_interactions} browser sessions)"
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
    # Site playbooks whose navigation guidance was injected into a turn, recorded so a
    # reviewer can tell whether the run used a playbook that was wrong.
    playbooks_used: list[str] = field(default_factory=list)
    # Curation outcomes the caller is entitled to see: what was refused, and what was dropped
    # before it ever became a candidate. A run that quietly skipped eight sources and read two
    # is indistinguishable from one that found only two.
    refusals: list[dict[str, str]] = field(default_factory=list)
    dropped_candidates: list[dict[str, Any]] = field(default_factory=list)
    duplicates_collapsed: int = 0
    scraped_pages: set[str] = field(default_factory=set)
    # The query plan the run actually used, recorded by the graph so metadata can show what
    # was dropped for duplication or budget.
    search_strategy: dict[str, Any] | None = None

    budget: StepBudget = field(default=None)  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.budget is None:
            self.budget = StepBudget(
                max_loops=self.limits.max_loops,
                max_searches=self.limits.max_searches_per_run,
                max_scrapes=self.limits.max_scrapes_per_run,
                max_interactions=self.limits.max_interactions_per_run,
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
            parts = existing.source_type.split("+")
            if source_type not in parts:
                # A searched-then-read URL is stronger evidence than a search hit alone,
                # and read-then-acted-on is stronger still. Recording which tools touched
                # it is what lets a reviewer distinguish the two.
                existing.source_type = "+".join([*parts, source_type])
            return existing
        source = SourceObserved(url=url, title=title, snippet=snippet, source_type=source_type)
        self.sources[url] = source
        return source

    def observed_urls(self) -> set[str]:
        return set(self.sources)

    def observed_canonicals(self) -> set[str]:
        """Identity keys of every page this run has already been given, so a second URL for the
        same page is recognised as a duplicate rather than a new source."""
        from app.curation.canonical import canonical_key

        return {canonical_key(url) for url in self.sources}

    def refuse(self, url: str, code: str, reason: str | None) -> None:
        entry = {"url": url, "code": code, "reason": reason or code}
        if entry not in self.refusals:
            self.refusals.append(entry)

    def note_dropped(self, url: str, code: str, reason: str, score: float | None = None) -> None:
        entry: dict[str, Any] = {"url": url, "code": code, "reason": reason}
        if score is not None:
            entry["score"] = round(score, 3)
        self.dropped_candidates.append(entry)

    def has_tool_data(self) -> bool:
        """Gate 2's precondition: at least one data tool returned something."""
        return any(message.status == "success" and message.content.strip() for message in self.messages
                   if message.role == "tool")
