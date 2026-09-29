"""Wire contract for `POST /ai/v1/quality/process`.

The pipeline is a pure function: records in, records plus a report out. Python holds no state,
so there is nothing here that a restart could lose — which is the property the no-Redis
constraint depends on.

Two rules shaped these models.

**Nothing is dropped.** A record that fails validation, a duplicate that was linked away, a value
that lost a conflict: all of them are returned, with the reason attached. The legacy pipeline
overwrote `record.sourceUrls` with only the tool-verified subset
(`ValidationService.ts:26,84`) and skipped rows whose sources did not hash-match a persisted
`Source` (`workflow-execution.repository.ts:271-272`), so a dataset could land short with no
explanation anywhere. Here the counts in `QualityReport` and the reasons on each record are the
explanation.

**No number is invented.** `confidence` is nullable and is only set from measured evidence; the
quality score names its own formula in `score_basis` and `score_components` because it is a
heuristic over counts, not a measurement of truth. The legacy formula
(`DataQualityService.ts:77-79`) was a weight soup the UI then labelled "confidence".
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import Field, field_validator

from app.contracts import CamelModel, QualityIssue, ValidationRule

StageName = Literal["normalize", "validate", "deduplicate", "resolve", "merge", "score"]

VERIFICATION_SOURCE_CITED = "SOURCE_CITED"
VERIFICATION_UNVERIFIED = "SOURCE_CITED_UNVERIFIED"
VERIFICATION_UNSUPPORTED = "UNSUPPORTED"
VERIFICATION_CONFLICTED = "CONFLICTED"


class SourceRef(CamelModel):
    """A source as the collection run observed it.

    `verified_by_tool` is the anti-fabrication flag: true only when a tool actually returned this
    URL during the run. A URL the model merely mentioned keeps its place in the list with the flag
    false, rather than being filtered out — dropping it would hide the fact that a record cited
    something nobody fetched.
    """

    url: str
    title: str = ""
    snippet: str = ""
    source_type: str = "search"
    retrieved_at: str | None = None
    verified_by_tool: bool = False


class RecordIn(CamelModel):
    values: dict[str, Any]
    sources: list[SourceRef] = Field(default_factory=list)


class FieldSpec(CamelModel):
    """A declared field, with the type that decides how its value is normalized."""

    key: str
    label: str = ""
    type: str = "STRING"
    required: bool = False


class QualityRequest(CamelModel):
    records: list[RecordIn] = Field(default_factory=list)
    extraction_schema: dict[str, Any] = Field(default_factory=dict)
    entity_type: str = ""
    objective: str = ""
    fields: list[FieldSpec] = Field(default_factory=list)
    required_fields: list[str] = Field(default_factory=list)
    deduplication_keys: list[str] = Field(default_factory=list)
    validation_rules: list[ValidationRule] = Field(default_factory=list)
    # Supplied by the caller so the raw→final drop is visible even when an earlier stage lost
    # records. The legacy report fell back to the current length
    # (`DataQualityService.ts:36`), which made a silent loss arithmetically invisible.
    raw_record_count: int | None = None
    # Bounds, not defaults: a request may narrow them, and an absent value means "use the
    # service's configured bound", never "unbounded".
    entity_match_threshold: float | None = None
    max_block_size: int | None = None

    @field_validator("entity_match_threshold")
    @classmethod
    def threshold_in_range(cls, value: float | None) -> float | None:
        if value is not None and not 0.5 <= value <= 1.0:
            raise ValueError("entityMatchThreshold must be between 0.5 and 1.0")
        return value

    @field_validator("max_block_size")
    @classmethod
    def block_size_positive(cls, value: int | None) -> int | None:
        if value is not None and value < 2:
            raise ValueError("maxBlockSize must be at least 2")
        return value


class Conflict(CamelModel):
    """Two sources disagreed about one field. Both values survive, with their own provenance."""

    field_key: str
    kept_value: Any = None
    rejected_value: Any = None
    kept_sources: list[str] = Field(default_factory=list)
    rejected_sources: list[str] = Field(default_factory=list)
    # Which rule decided it, named: "evidence-count", "recency" or "canonical-position". A
    # conflict resolved by an unnamed rule is indistinguishable from one resolved arbitrarily,
    # which is what the legacy merge did (first value in array order won).
    resolved_by: str = ""


class Evidence(CamelModel):
    """Measured facts about a record's backing. No formula, no inference — just counts."""

    source_count: int = 0
    verified_source_count: int = 0
    unverified_source_count: int = 0
    distinct_domains: int = 0
    fields_with_evidence: int = 0


class RecordOut(CamelModel):
    index: int
    values: dict[str, Any]
    raw_values: dict[str, Any] = Field(default_factory=dict)
    sources: list[SourceRef] = Field(default_factory=list)
    is_valid: bool = True
    issues: list[QualityIssue] = Field(default_factory=list)
    verification_status: str = VERIFICATION_UNSUPPORTED
    evidence: Evidence = Field(default_factory=Evidence)
    confidence: float | None = None
    # Duplicates are linked, never deleted: `duplicate_of` is the index of the canonical record
    # and `match_type` says how strong the match was.
    duplicate_of: int | None = None
    duplicate_key: str | None = None
    match_type: Literal["EXACT", "NORMALIZED", "ENTITY", None] = None
    review_required: bool = False
    review_reasons: list[str] = Field(default_factory=list)
    conflicts: list[Conflict] = Field(default_factory=list)
    # What normalization changed, per field, so a surprising value can be traced to the rule that
    # produced it instead of being indistinguishable from what the source said.
    normalization_notes: list[str] = Field(default_factory=list)


class Column(CamelModel):
    key: str
    label: str = ""
    type: str = "STRING"
    required: bool = False
    position: int = 0


class Row(CamelModel):
    """A row of the final dataset: the record index it came from, and its normalized values."""

    record_index: int
    values: dict[str, Any]


class Dataset(CamelModel):
    columns: list[Column] = Field(default_factory=list)
    rows: list[Row] = Field(default_factory=list)


class StageReport(CamelModel):
    stage: StageName
    status: Literal["COMPLETED", "FAILED", "SKIPPED"] = "COMPLETED"
    input_count: int = 0
    output_count: int = 0
    metrics: dict[str, Any] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)
    error: str | None = None


class QualityReport(CamelModel):
    raw_count: int = 0
    normalized_count: int = 0
    valid_count: int = 0
    invalid_count: int = 0
    duplicate_count: int = 0
    review_required_count: int = 0
    conflict_count: int = 0
    source_backed_count: int = 0
    quality_score: float | None = None
    score_basis: str = ""
    score_components: dict[str, float] = Field(default_factory=dict)
    metrics: dict[str, Any] = Field(default_factory=dict)


class QualityResult(CamelModel):
    status: Literal["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED"] = "COMPLETED"
    records: list[RecordOut] = Field(default_factory=list)
    dataset: Dataset = Field(default_factory=Dataset)
    stages: list[StageReport] = Field(default_factory=list)
    quality: QualityReport = Field(default_factory=QualityReport)
    warnings: list[str] = Field(default_factory=list)
    failure_reason: str | None = None
