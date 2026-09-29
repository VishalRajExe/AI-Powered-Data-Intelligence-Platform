"""Search strategy: one list of queries, deduplicated, fitted to the run's budget.

`web-research-agent-master` asks an LLM to decompose the topic into subqueries
(`utils/analyze_query.py:15-33`) and then fires `num_results=10` at each one (`main.py:64`) with
no deduplication — two near-identical subqueries are two billable searches. Its failure path
(`analyze_query.py:44-51`) also returns `intent="unknown"` and carries on, so a dead provider
still produces a run.

This stage does **not** ask a model anything. Phase 3's requirement analysis already emits
`searchQueries` from the same structured call that produces the contract; adding a second LLM
call purely to rewrite queries would be the duplicate search system this phase is told not to
build. What is ported is the useful half: decomposition already exists, so this normalises,
deduplicates and fits the list to the search budget.

`app.contracts.SearchStrategy` has been in the codebase since Phase 0 with nothing constructing
it. This module is now its only producer.
"""
from __future__ import annotations

import re

from app.contracts import SearchStrategy

_WHITESPACE = re.compile(r"\s+")


def normalise_query(query: str) -> str:
    return _WHITESPACE.sub(" ", (query or "").strip()).lower()


def deduplicate(queries: list[str]) -> list[str]:
    """First spelling wins; comparison is case- and whitespace-insensitive.

    A list arriving as `["AI startups India", "ai startups  india"]` from a model is one search,
    not two, and the run's budget should not pay twice for a formatting accident.
    """
    seen: set[str] = set()
    kept: list[str] = []
    for query in queries:
        key = normalise_query(query)
        if not key or key in seen:
            continue
        seen.add(key)
        kept.append(key)
    return kept


def build_strategy(*, queries: list[str], max_queries: int, desired_sources: int | None = None
                   ) -> SearchStrategy:
    """Fit the requested queries to the budget the run actually has.

    Truncation is visible rather than silent: `SearchStrategy.queries` is what will run, and
    `dropped_count` tells the caller how many did not, which it reports in metadata.
    """
    cleaned = deduplicate(queries)
    return SearchStrategy(
        queries=cleaned[:max(0, max_queries)],
        desired_source_count=desired_sources,
        maximum_source_count=None,
        max_requests_per_domain_per_minute=20,
    )


def dropped_count(*, requested: list[str], strategy: SearchStrategy) -> int:
    return max(0, len(deduplicate(requested)) - len(strategy.queries))
