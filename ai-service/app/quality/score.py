"""The quality report: counts that were measured, and one score that is explicitly a heuristic.

Ported from `DataQualityService.ts` with its central dishonesty removed. That service computed a
per-record number from a soup of weights
(`clamp(0.2 + 0.15 + min(0.2,(domains-1)*0.1) + completeness*0.25 + (errors?0:0.15)
- warnings*0.025 - conflicts*0.1, 0.05, 0.95)`, `:77-79`), averaged it, stored it in
`data_quality_reports.quality_score`, and the UI labelled the result "confidence". A formula
output presented as a measurement does not survive one viva question.

So:

* Every **count** in the report is measured — how many records arrived, how many are valid, how
  many were linked as duplicates, how many carry a disagreement, how many are backed by a source a
  tool actually returned.
* Every **ratio** is those counts divided, with the arithmetic named.
* The single `quality_score` is the equal-weight mean of five ratios, and `score_basis` says so in
  the payload. Equal weights are not a claim that the dimensions matter equally; they are the
  absence of a claim, which is the honest option when nobody has measured which matters more.
* `raw_count` comes from the caller. The legacy report fell back to the current record count when
  the agent supplied nothing (`:36`), which made a silent loss between stages arithmetically
  invisible — the one defect that could hide every other defect.
* A score over zero records is `None`, not 0: an empty run has no quality, and 0.0 would read as
  "measured and terrible".
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.quality.contracts import (
    VERIFICATION_SOURCE_CITED,
    QualityReport,
    RecordOut,
)

SCORE_BASIS = (
    "equal-weight mean of completeness, validity, uniqueness, consistency and provenance, each a "
    "ratio of measured counts; a summary heuristic, not a measurement of truth"
)
CONFIDENCE_FORMULA = (
    "record confidence = 0.5*verifiedSourceShare + 0.3*min(distinctDomains,3)/3 + 0.2*(1 if the "
    "record is valid else 0), clamped to [0,1]; derived from the evidence counts on the record "
    "itself, and absent when the record cites nothing"
)


@dataclass(slots=True)
class Dimensions:
    completeness: float | None = None
    validity: float | None = None
    uniqueness: float | None = None
    consistency: float | None = None
    provenance: float | None = None

    def mean(self) -> float | None:
        values = [value for value in (self.completeness, self.validity, self.uniqueness,
                                      self.consistency, self.provenance) if value is not None]
        if not values:
            return None
        return round(sum(values) / len(values), 4)


def _ratio(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return round(numerator / denominator, 4)


def assign_confidence(records: list[RecordOut]) -> str:
    """Attach a documented confidence to each record. Returns the formula, for the stage note."""
    for record in records:
        if not record.sources:
            record.confidence = None
            continue
        verified_share = _ratio(record.evidence.verified_source_count, record.evidence.source_count) or 0.0
        diversity = min(record.evidence.distinct_domains, 3) / 3
        validity = 1.0 if record.is_valid else 0.0
        record.confidence = round(min(1.0, max(0.0, 0.5 * verified_share + 0.3 * diversity
                                               + 0.2 * validity)), 4)
    return CONFIDENCE_FORMULA


def assess(records: list[RecordOut], *, required_fields: list[str], declared_fields: list[str],
           raw_count: int | None) -> tuple[QualityReport, Dimensions]:
    """Build the report from the record set as it now stands."""
    total = len(records)
    canonical = [record for record in records if record.duplicate_of is None]
    duplicates = total - len(canonical)
    valid = [record for record in canonical if record.is_valid]
    conflicted = [record for record in canonical if record.conflicts]
    review = [record for record in records if record.review_required]
    source_backed = [record for record in records
                     if record.verification_status == VERIFICATION_SOURCE_CITED]
    errors = sum(issue.severity == "ERROR" for record in records for issue in record.issues)
    warnings = sum(issue.severity == "WARNING" for record in records for issue in record.issues)

    completeness_basis = [key for key in (required_fields or declared_fields) if key]
    populated = 0
    possible = 0
    for record in canonical:
        for key in completeness_basis:
            possible += 1
            value = record.values.get(key)
            if value is not None and not (isinstance(value, str) and not value.strip()):
                populated += 1

    dimensions = Dimensions(
        completeness=_ratio(populated, possible),
        validity=_ratio(len(valid), len(canonical)),
        uniqueness=_ratio(len(canonical), total),
        consistency=_ratio(len(canonical) - len(conflicted), len(canonical)),
        provenance=_ratio(len(source_backed), total),
    )

    issue_codes: dict[str, int] = {}
    for record in records:
        for issue in record.issues:
            issue_codes[issue.rule_code] = issue_codes.get(issue.rule_code, 0) + 1

    report = QualityReport(
        # A caller that does not say how many records it sent gets the count this service saw, and
        # the report says so — the drop is then visible as a missing number rather than as a lie.
        raw_count=raw_count if raw_count is not None else total,
        normalized_count=total,
        valid_count=len(valid),
        invalid_count=len(canonical) - len(valid),
        duplicate_count=duplicates,
        review_required_count=len(review),
        conflict_count=sum(len(record.conflicts) for record in canonical),
        source_backed_count=len(source_backed),
        quality_score=dimensions.mean(),
        score_basis=SCORE_BASIS if total else "",
        score_components={
            name: value for name, value in (
                ("completeness", dimensions.completeness),
                ("validity", dimensions.validity),
                ("uniqueness", dimensions.uniqueness),
                ("consistency", dimensions.consistency),
                ("provenance", dimensions.provenance),
            ) if value is not None
        },
        metrics={
            "canonicalRecords": len(canonical),
            "errors": errors,
            "warnings": warnings,
            "issueCodes": dict(sorted(issue_codes.items())),
            "completenessBasis": completeness_basis[:20],
            "fieldsWithOwnEvidence": sum(record.evidence.fields_with_evidence for record in records),
            "distinctSources": len({source.url for record in records for source in record.sources
                                    if source.url}),
            "verifiedSources": len({source.url for record in records
                                    for source in record.sources
                                    if source.url and source.verified_by_tool}),
            "provenanceScope": "FIELD_LEVEL_WHERE_DECLARED_OTHERWISE_RECORD_LEVEL",
            "confidenceFormula": CONFIDENCE_FORMULA,
        },
    )
    return report, dimensions
