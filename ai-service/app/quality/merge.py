"""Conflict handling: when two records disagree, keep both and say who won and why.

Ported in shape from `recordMerge.ts`, which preserved the losing value in `quality.conflicts` —
the one thing it got right — and replaced in substance, because its winner was whichever record
happened to be earlier in the array. That is not a policy, it is an accident of retrieval order,
and two runs over the same sources in a different order would produce two different datasets.

The rule here is ordered, stated, and recorded on every conflict:

1. **Evidence count** — the value backed by more distinct tool-verified sources wins.
2. **Recency** — on a tie, the value from the more recently retrieved source wins.
3. **Canonical position** — on a further tie, the canonical record keeps what it had.

Rule 3 is what makes the outcome deterministic rather than merely usual. Whichever rule fired is
named in `resolved_by`, and the rejected value stays in the payload with its own sources, so a
reviewer can disagree with the choice and see exactly what was set aside.

Attribution is **record-level**, because that is all the extraction stage produces: a value's
sources are the sources of the record it came from. Field-level provenance is not inferred here —
inventing it would be the fabrication this pipeline exists to prevent.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from app.curation.canonical import canonical_key
from app.quality.contracts import Conflict, RecordOut

EVIDENCE_COUNT = "evidence-count"
RECENCY = "recency"
CANONICAL_POSITION = "canonical-position"


@dataclass(slots=True)
class Link:
    """One record is the same thing as another, so its values fold into the canonical row."""

    canonical_index: int
    duplicate_index: int
    match_type: Literal["EXACT", "NORMALIZED", "ENTITY"]
    reason: str = ""


@dataclass(slots=True)
class MergeResult:
    merged_records: int = 0
    conflicts: int = 0
    fields_filled: int = 0
    chains_collapsed: int = 0
    by_rule: dict[str, int] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def metrics(self) -> dict[str, Any]:
        return {
            "recordsMerged": self.merged_records,
            "conflictsRecorded": self.conflicts,
            "missingFieldsFilled": self.fields_filled,
            "chainsCollapsed": self.chains_collapsed,
            "resolvedByRule": dict(self.by_rule),
        }


def _verified_count(record: RecordOut) -> int:
    return sum(1 for source in record.sources if source.verified_by_tool)


def _latest_retrieval(record: RecordOut) -> str:
    stamps = [source.retrieved_at or "" for source in record.sources if source.verified_by_tool]
    return max(stamps) if stamps else ""


def _source_urls(record: RecordOut) -> list[str]:
    return [source.url for source in record.sources if source.url]


def _absent(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, dict):
        return value.get("amount") is None and not value.get("currency")
    if isinstance(value, (list, tuple)):
        return not value
    return False


def _equal(left: Any, right: Any) -> bool:
    if isinstance(left, str) and isinstance(right, str):
        return left.strip().casefold() == right.strip().casefold()
    return left == right


def apply_links(records: list[RecordOut], links: list[Link]) -> MergeResult:
    """Fold every linked record into its canonical one.

    Chains are resolved first. If A links to B and B links to C, A's values must land in C — the
    row the dataset actually keeps. Merging A into B instead would put them in a row that is itself
    a duplicate and appears nowhere in the final dataset, which is how the legacy pipeline's
    "linked, never deleted" guarantee quietly lost data anyway.

    Every duplicate is therefore folded into its *final* canonical, so the outcome does not depend
    on the order the links arrived in.
    """
    result = MergeResult()
    by_index = {record.index: record for record in records}
    target = {link.duplicate_index: link.canonical_index for link in links
              if link.canonical_index in by_index and link.duplicate_index in by_index
              and link.canonical_index != link.duplicate_index}

    def final(index: int) -> int:
        seen: set[int] = set()
        current = index
        while current in target and current not in seen:
            seen.add(current)
            current = target[current]
        return current

    folded: set[int] = set()
    for duplicate_index in sorted(target):
        destination = final(duplicate_index)
        if destination == duplicate_index or duplicate_index in folded:
            continue
        folded.add(duplicate_index)
        link = next(item for item in links if item.duplicate_index == duplicate_index)
        if destination != link.canonical_index:
            result.chains_collapsed += 1
        _merge_into(by_index[destination], by_index[duplicate_index], result)
        duplicate = by_index[duplicate_index]
        duplicate.duplicate_of = destination
        duplicate.match_type = link.match_type
        duplicate.duplicate_key = link.reason
        result.merged_records += 1

    if result.conflicts:
        result.notes.append(
            f"{result.conflicts} field disagreement(s) preserved with both values and both source "
            f"lists; resolved by "
            + ", ".join(f"{rule}×{count}" for rule, count in sorted(result.by_rule.items())))
    return result


def _merge_into(canonical: RecordOut, duplicate: RecordOut, result: MergeResult) -> None:
    for key, incoming in duplicate.values.items():
        if _absent(incoming):
            continue
        current = canonical.values.get(key)
        if _absent(current):
            canonical.values[key] = incoming
            result.fields_filled += 1
            continue
        if _equal(current, incoming):
            continue
        rule, kept, rejected, kept_record = _decide(canonical, duplicate, key, current, incoming)
        canonical.values[key] = kept
        canonical.conflicts.append(Conflict(
            field_key=key,
            kept_value=kept,
            rejected_value=rejected,
            kept_sources=_source_urls(kept_record),
            rejected_sources=_source_urls(duplicate if kept_record is canonical else canonical),
            resolved_by=rule,
        ))
        result.conflicts += 1
        result.by_rule[rule] = result.by_rule.get(rule, 0) + 1

    _union_sources(canonical, duplicate)
    for note in duplicate.normalization_notes:
        if note not in canonical.normalization_notes:
            canonical.normalization_notes.append(note)


def _decide(canonical: RecordOut, duplicate: RecordOut, key: str, current: Any,
            incoming: Any) -> tuple[str, Any, Any, RecordOut]:
    canonical_evidence = _verified_count(canonical)
    duplicate_evidence = _verified_count(duplicate)
    if canonical_evidence != duplicate_evidence:
        winner = canonical if canonical_evidence > duplicate_evidence else duplicate
        kept = current if winner is canonical else incoming
        return EVIDENCE_COUNT, kept, incoming if winner is canonical else current, winner

    canonical_stamp = _latest_retrieval(canonical)
    duplicate_stamp = _latest_retrieval(duplicate)
    if canonical_stamp != duplicate_stamp:
        winner = canonical if canonical_stamp > duplicate_stamp else duplicate
        kept = current if winner is canonical else incoming
        return RECENCY, kept, incoming if winner is canonical else current, winner

    return CANONICAL_POSITION, current, incoming, canonical


def _union_sources(canonical: RecordOut, duplicate: RecordOut) -> None:
    seen = {canonical_key(source.url) for source in canonical.sources if source.url}
    for source in duplicate.sources:
        key = canonical_key(source.url) if source.url else ""
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        canonical.sources.append(source)
