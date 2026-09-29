"""Entity resolution: which records are the same real-world thing?

Ported from `EntityResolutionService.ts`, keeping its central safety rule and fixing the bug that
undercut it.

**Kept: a shared stable identifier is required to merge.** Two records whose names are 97 % similar
are *not* merged on that evidence alone — "Acme Corp" and "Acme Corporation" in different cities
may well be different companies. Similarity alone yields `REVIEW_REQUIRED`, which is a queue for a
human, not a decision. The legacy module did this and the audit marked it as the thing to preserve.

**Fixed: identifier evidence now actually outranks name similarity.** The legacy candidate loop
compared `confidence > selected.confidence` (`:47`), so a 0.96 name match with no shared identifier
could displace an already-selected shared-identifier match — the priority it claimed to implement
was not enforced. Candidates are ordered here by (has identifier, similarity, index), so an
identifier match can only be beaten by another identifier match.

**Fixed: the name field is chosen deterministically and its absence is reported.** The legacy
module took the first schema key matching a regex with an optional group (`:15,20`) — effectively
any key ending in `name`, in schema order — and silently no-oped when none matched (`:21`). Here
the choice is an ordered, stated preference, and when nothing qualifies the stage reports that it
did nothing rather than passing quietly.

Similarity is Levenshtein ratio, computed in-house: `rapidfuzz` would be a compiled dependency for
one bounded string distance, and this project has twice preferred no new dependency over a
convenience (see `Memory.md` §3).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.quality.contracts import RecordOut
from app.quality.dedupe import canonical_rank
from app.quality.normalize import fold_key

# Legal noise in a company name. Applied as whole tokens only: the legacy list included bare
# `co` and `private` and stripped them anywhere in the string (`:14`), so "Costco" became "stco".
LEGAL_SUFFIXES = frozenset({
    "inc", "incorporated", "llc", "llp", "lp", "ltd", "limited", "plc", "corp", "corporation",
    "company", "co", "gmbh", "ag", "sa", "sas", "sarl", "srl", "spa", "bv", "nv", "as", "ab",
    "oy", "pty", "pvt", "private", "public", "the",
})

# A field whose *value* identifies the entity rather than describing it. Two records sharing one of
# these are the same thing far more reliably than two records with similar names.
IDENTIFIER_HINTS = (
    "url", "uri", "link", "website", "domain", "homepage", "email", "handle", "username",
    "registration", "tax", "vat", "ein", "cin", "lei", "isin", "sku", "id", "identifier",
    "license", "licence", "phone", "telephone",
)

NAME_KEY_CANDIDATES = ("name", "title", "label")

MERGE = "MERGE"
REVIEW_REQUIRED = "REVIEW_REQUIRED"
KEEP_SEPARATE = "KEEP_SEPARATE"


@dataclass(slots=True)
class Candidate:
    other: RecordOut
    similarity: float
    identifier_match: bool
    matched_identifiers: list[str] = field(default_factory=list)
    decision: str = KEEP_SEPARATE


@dataclass(slots=True)
class ResolutionResult:
    merged: int = 0
    review_required: int = 0
    name_field: str | None = None
    comparisons: int = 0
    blocks: int = 0
    oversized_blocks: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def metrics(self) -> dict[str, Any]:
        return {
            "merged": self.merged,
            "reviewRequired": self.review_required,
            "nameField": self.name_field,
            "comparisons": self.comparisons,
            "blocksUsed": self.blocks,
            "oversizedBlocks": len(self.oversized_blocks),
        }


def choose_name_field(records: list[RecordOut], declared: list[str]) -> str | None:
    """The field entity names live in, chosen by an ordered rule rather than by schema order."""
    keys = [fold_key(key) for key in declared]
    present: set[str] = set()
    for record in records:
        present.update(record.values.keys())

    for candidate in ("name", "entity_name", "company_name", "channel_name", "product_name",
                      "person_name", "speaker_name", "job_title", "role_title", "title"):
        if candidate in present:
            return candidate
    for key in keys:
        if key in present and key.endswith("_name"):
            return key
    for key in keys:
        if key in present and any(token in key for token in NAME_KEY_CANDIDATES):
            return key
    for key in sorted(present):
        if key == "name" or key.endswith("_name"):
            return key
    return None


def normalize_name(value: Any) -> str:
    if value is None:
        return ""
    tokens = [token for token in fold_key(str(value)).split("_") if token]
    kept = [token for token in tokens if token not in LEGAL_SUFFIXES]
    # A name that is *only* legal suffixes ("Ltd") keeps them: stripping everything would make
    # every such record look identical, which is worse than not normalizing it.
    return "_".join(kept or tokens)


def identifier_values(record: RecordOut) -> dict[str, str]:
    """Stable identifiers this record carries, keyed by a comparable identity."""
    found: dict[str, str] = {}
    for key, value in record.values.items():
        if value is None:
            continue
        folded = fold_key(key)
        if not any(hint in folded for hint in IDENTIFIER_HINTS):
            continue
        if isinstance(value, dict):
            continue
        text = str(value).strip().casefold()
        if not text:
            continue
        if "://" in text or folded.endswith(("_url", "_uri", "_link", "website", "domain")):
            from app.curation.canonical import canonical_key

            canonical = canonical_key(text)
            if canonical:
                # The whole canonical page, never just its host. Two speakers on one conference
                # site are not the same person, and keying on the host would merge every record
                # that site provided.
                found[f"{folded}:{canonical}"] = text
                continue
        if "@" in text:
            found[f"email:{text}"] = text
            continue
        digits = "".join(character for character in text if character.isalnum())
        if len(digits) >= 5:
            found[f"{folded}:{digits}"] = text
    return found


def levenshtein_ratio(left: str, right: str) -> float:
    """1 - (edit distance / longer length), exactly.

    No early exit: an approximation here would be a threshold nobody can reason about, and the
    caller has already bounded the work by blocking and by `max_block_size`.
    """
    if left == right:
        return 1.0
    if not left or not right:
        return 0.0
    if len(left) > len(right):
        left, right = right, left
    previous = list(range(len(left) + 1))
    for index, right_char in enumerate(right, start=1):
        current = [index]
        for position, left_char in enumerate(left, start=1):
            cost = 0 if left_char == right_char else 1
            current.append(min(previous[position] + 1, current[position - 1] + 1,
                               previous[position - 1] + cost))
        previous = current
    return 1.0 - previous[-1] / max(len(left), len(right))


def _block_key(name: str) -> str:
    compact = name.replace("_", "")
    return compact[:3] if len(compact) >= 3 else compact


def resolve(records: list[RecordOut], *, name_field: str | None, threshold: float = 0.94,
            max_block_size: int = 400) -> tuple[ResolutionResult, list[tuple[RecordOut, Candidate]]]:
    """Group records into blocks, then decide each pair.

    Returns the stage report and the accepted matches, so the caller — not this function — performs
    the merge and decides what a conflict means.
    """
    result = ResolutionResult(name_field=name_field)
    accepted: list[tuple[RecordOut, Candidate]] = []
    if not name_field:
        result.notes.append(
            "no field could be identified as the entity name (looked for `name`, `*_name`, a "
            "declared field containing `name`/`title`), so entity resolution compared nothing; "
            "duplicate keys still applied")
        return result, accepted

    live = [record for record in records if record.duplicate_of is None]
    blocks: dict[str, list[RecordOut]] = {}
    for record in live:
        name = normalize_name(record.values.get(name_field))
        if not name:
            continue
        blocks.setdefault(_block_key(name), []).append(record)
        for identity in identifier_values(record):
            blocks.setdefault(f"id:{identity}", []).append(record)

    result.blocks = len(blocks)
    seen_pairs: set[tuple[int, int]] = set()
    for key, block in blocks.items():
        if len(block) < 2:
            continue
        if len(block) > max_block_size:
            result.oversized_blocks.append(f"{key[:60]} ({len(block)} records)")
            continue
        for position, record in enumerate(block):
            for other in block[position + 1:]:
                pair = (min(record.index, other.index), max(record.index, other.index))
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)
                result.comparisons += 1
                candidate = _compare(record, other, name_field, threshold)
                if candidate is not None:
                    accepted.append((record, candidate))

    # One decision per record, best evidence first: an identifier match outranks any name-only
    # match, which is the priority the legacy candidate loop failed to enforce.
    best: dict[int, tuple[RecordOut, Candidate]] = {}
    for record, candidate in sorted(
            accepted, key=lambda item: (item[1].identifier_match, item[1].similarity),
            reverse=True):
        if record.index in best:
            continue
        best[record.index] = (record, candidate)

    ordered = list(best.values())
    for record, candidate in ordered:
        if candidate.decision == MERGE:
            result.merged += 1
        elif candidate.decision == REVIEW_REQUIRED:
            result.review_required += 1
            record.review_required = True
            record.review_reasons.append(
                f"{candidate.other.index}: name similarity {candidate.similarity:.3f} with no "
                f"shared identifier — merging would be a guess")
    return result, ordered


def _compare(record: RecordOut, other: RecordOut, name_field: str,
             threshold: float) -> Candidate | None:
    left_identifiers = identifier_values(record)
    right_identifiers = identifier_values(other)
    shared = sorted(set(left_identifiers) & set(right_identifiers))
    similarity = levenshtein_ratio(normalize_name(record.values.get(name_field)),
                                   normalize_name(other.values.get(name_field)))

    if shared:
        return Candidate(other=other, similarity=similarity, identifier_match=True,
                         matched_identifiers=shared, decision=MERGE)
    if similarity >= threshold:
        return Candidate(other=other, similarity=similarity, identifier_match=False,
                         decision=REVIEW_REQUIRED)
    return None


def pick_canonical(record: RecordOut, other: RecordOut) -> RecordOut:
    """The same rule deduplication uses, so a merge cannot pick a different winner than a link."""
    return record if canonical_rank(record) >= canonical_rank(other) else other
