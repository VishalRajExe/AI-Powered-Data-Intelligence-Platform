"""Deduplication: link records that are the same thing, delete nothing.

Ported from `DeduplicationService.ts` with three of its shortcuts replaced:

* **Canonical selection is a stated rule, not array position.** The legacy service made the first
  record it met the canonical one (`:44-49`), so which copy of a company survived depended on the
  order a search happened to return. Here the canonical record is the one with the most
  tool-verified sources, then the most populated fields, then the lowest index — deterministic,
  explainable, and biased toward the copy that has the most evidence behind it.
* **No invented match confidence.** The legacy service wrote `EXACT ? 1 : 0.99` (`:45`). A
  normalized-key match is not 99 % of anything; it is an identity after a documented
  canonicalization, so it is recorded as `match_type` with confidence 1.0, and fuzzy matches carry
  the similarity that was actually measured.
* **A block that is too large is reported, not silently compared.** Without a bound, one
  pathological key (every record with an empty name) turns blocking into an O(n²) comparison the
  caller waits for.

Duplicates are **linked**, never deleted: `duplicate_of` points at the canonical index and the row
stays in the result, because a merge that discards the loser cannot be audited afterwards.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.quality.contracts import RecordOut
from app.quality.normalize import fold_key

EXACT = "EXACT"
NORMALIZED = "NORMALIZED"


@dataclass(slots=True)
class DeduplicationResult:
    linked: int = 0
    blocks: int = 0
    # (canonical index, duplicate index, match type, key) for each link. The caller merges them,
    # because merging needs the same conflict rules entity resolution uses and belongs in one place.
    links: list[tuple[int, int, str, str]] = field(default_factory=list)
    oversized_blocks: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def metrics(self) -> dict[str, Any]:
        return {
            "duplicatesLinked": self.linked,
            "blocksUsed": self.blocks,
            "oversizedBlocks": len(self.oversized_blocks),
        }


def _identity(value: Any) -> str:
    """A comparison key for one field value."""
    if value is None:
        return ""
    if isinstance(value, dict):
        amount = value.get("amount")
        code = value.get("currency")
        return f"{amount!r}|{str(code or '').upper()}"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        return repr(round(value, 9))
    return str(value).strip().casefold()


def _url_identity(value: Any) -> str:
    from app.curation.canonical import canonical_key

    return canonical_key(str(value)) if value else ""


def dedupe_key(record: RecordOut, keys: list[str], *, normalized: bool) -> str | None:
    """The identity of a record over the declared keys, or None when it cannot be established.

    A record missing any key field gets no key at all, and therefore never matches: guessing an
    identity from the fields that happen to be present is how two different records get merged.

    Two scopes, and they mean different things. `EXACT` compares what the sources literally said,
    before normalization touched it, so it only matches when two records agree word for word (case
    and surrounding whitespace aside). `NORMALIZED` compares the canonicalized values, which is what
    makes `https://www.openai.com/?utm_source=x` and `https://openai.com/` one page. Reporting the
    second as the first would claim a stronger match than was actually made.
    """
    if not keys:
        return None
    values = _comparison_view(record, normalized)
    parts: list[str] = []
    for key in keys:
        folded = fold_key(key)
        if folded not in values:
            return None
        value = values.get(folded)
        if value is None or (isinstance(value, str) and not value.strip()):
            return None
        if normalized and _is_url_field(folded, value):
            parts.append(_url_identity(value))
        else:
            parts.append(_identity(value))
    scope = "n" if normalized else "x"
    return f"{scope}:" + "\u0000".join(parts)


def _comparison_view(record: RecordOut, normalized: bool) -> dict[str, Any]:
    """The values a comparison reads: canonicalized, or as the source wrote them."""
    if normalized:
        return record.values
    view = {fold_key(key): value for key, value in record.raw_values.items()}
    # A field normalization created (or a merge filled in) has no raw form; fall back rather than
    # treat the record as unidentifiable.
    for key, value in record.values.items():
        view.setdefault(key, value)
    return view


def _is_url_field(key: str, value: Any) -> bool:
    return isinstance(value, str) and ("://" in value or key.endswith(("_url", "_uri", "_link")))


def canonical_rank(record: RecordOut) -> tuple[int, int, int]:
    """Higher is better; the last element is negated so a lower index wins a genuine tie."""
    verified = sum(1 for source in record.sources if source.verified_by_tool)
    populated = sum(1 for value in record.values.values()
                    if value is not None and not (isinstance(value, str) and not value.strip()))
    return (verified, populated, -record.index)


def deduplicate(records: list[RecordOut], keys: list[str], *, max_block_size: int = 400) -> DeduplicationResult:
    """Link duplicates over the declared keys. Exact and normalized matches, no fuzzy guessing."""
    result = DeduplicationResult()
    if not keys:
        result.notes.append("the requirement declared no deduplicationKeys, so no record was "
                            "compared against another; duplicates can only be found by entity "
                            "resolution, which needs a shared identifier")
        return result

    exact: dict[str, list[RecordOut]] = {}
    normalized: dict[str, list[RecordOut]] = {}
    for record in records:
        exact_key = dedupe_key(record, keys, normalized=False)
        if exact_key is not None:
            exact.setdefault(exact_key, []).append(record)
        normalized_key = dedupe_key(record, keys, normalized=True)
        if normalized_key is not None:
            normalized.setdefault(normalized_key, []).append(record)

    result.blocks = len(exact) + len(normalized)
    for scope, blocks in ((EXACT, exact), (NORMALIZED, normalized)):
        for key, block in blocks.items():
            if len(block) < 2:
                continue
            if len(block) > max_block_size:
                # Reported, and the block is left alone: comparing 10 000 records that share one
                # empty key would produce 50 million pairs and a canonical choice nobody could
                # defend.
                result.oversized_blocks.append(f"{scope}:{key[:80]} ({len(block)} records)")
                continue
            canonical = max(block, key=canonical_rank)
            for record in block:
                if record.index == canonical.index:
                    continue
                # The stronger match wins if a record is reachable both ways: an exact identity
                # is a better reason to link than a normalized one.
                if record.duplicate_of is not None and record.match_type == EXACT:
                    continue
                record.duplicate_of = canonical.index
                record.duplicate_key = key
                record.match_type = scope
                result.linked += 1
                result.links.append((canonical.index, record.index, scope, key))

    if result.linked:
        result.notes.append(
            f"{result.linked} record(s) linked to a canonical row over "
            f"{', '.join(fold_key(k) for k in keys)}; none were deleted")
    return result
