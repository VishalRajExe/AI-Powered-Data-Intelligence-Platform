"""Source aggregation: which sources the result actually rests on, and what rests on nothing.

`web-research-agent-master` builds its source list with
`list({c.metadata['source'] for c in relevant_chunks})` (`result_aggregator_tool.py:39`) — a set
comprehension, so the "sources" arrive in an order that varies between runs, with no count of
how much each one carries, and its own `[Source 1]`-style citations cannot be resolved because
no numbering map is ever given to the model (`result_aggregator_tool.py:17`).

This version keeps first-observed order, counts citations per source, and separates two things
that must never be conflated: URLs a record cites that a tool actually retrieved, and URLs the
model merely mentioned. Nothing is dropped for want of evidence — an unsupported record is a
visible problem the caller decides about, which is the rule the old project broke when
`persistDataset` skipped rows without verified sources (`docs/audit/00-FORENSIC-AUDIT.md` §5,
item 8).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.research.state import SourceObserved


@dataclass(slots=True)
class Aggregation:
    sources: list[dict[str, Any]] = field(default_factory=list)
    record_indices_without_evidence: list[int] = field(default_factory=list)
    unverified_urls: list[str] = field(default_factory=list)
    duplicates_collapsed: int = 0

    def as_validation_bits(self) -> dict[str, Any]:
        return {
            "recordsWithoutEvidence": list(self.record_indices_without_evidence),
            "unverifiedUrls": list(self.unverified_urls),
            "duplicateSourcesCollapsed": self.duplicates_collapsed,
        }


def aggregate_sources(sources: dict[str, SourceObserved],
                      *,
                      citations_by_record: list[list[str]],
                      mentioned_by_record: list[list[str]] | None = None,
                      duplicates_collapsed: int = 0) -> Aggregation:
    """`citations_by_record[i]` = URLs record *i* cites that this run retrieved.

    `mentioned_by_record[i]` = every URL that appears in record *i*'s values. The difference
    between the two is what the model asserted without evidence, and it is reported, not
    discarded.
    """
    counts: dict[str, int] = {url: 0 for url in sources}
    unsupported: list[int] = []
    unverified: list[str] = []

    for index, citations in enumerate(citations_by_record):
        if not citations:
            unsupported.append(index)
        for url in citations:
            if url in counts:
                counts[url] += 1

    mentioned = mentioned_by_record or []
    for citations in mentioned:
        for url in citations:
            if url not in sources and url not in unverified:
                unverified.append(url)

    # First-observed order is what a reader expects from a run log: the source list should not
    # reorder itself because a later record cited an earlier page twice.
    payload = []
    for url, source in sources.items():
        entry = source.as_dict()
        entry["citedByRecords"] = counts.get(url, 0)
        payload.append(entry)

    return Aggregation(
        sources=payload,
        record_indices_without_evidence=unsupported,
        unverified_urls=unverified,
        duplicates_collapsed=duplicates_collapsed,
    )
