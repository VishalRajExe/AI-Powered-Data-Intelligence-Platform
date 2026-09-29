"""Wire contracts shared with the Spring Boot backend (Pydantic is authoritative).

JSON serializes to camelCase so the Java DTO mirrors field-for-field.
"""
from __future__ import annotations

import re
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SNAKE = re.compile(r"^[a-z][a-z0-9_]*$")


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=lambda s: re.sub(r"_(.)", lambda m: m.group(1).upper(), s),
                              populate_by_name=True)


class FieldType(str, Enum):
    STRING = "STRING"
    NUMBER = "NUMBER"
    BOOLEAN = "BOOLEAN"
    DATE = "DATE"
    DATETIME = "DATETIME"
    URL = "URL"
    EMAIL = "EMAIL"
    PHONE = "PHONE"
    CURRENCY = "CURRENCY"
    JSON = "JSON"


class FilterOperator(str, Enum):
    EQ = "EQ"
    NEQ = "NEQ"
    GT = "GT"
    GTE = "GTE"
    LT = "LT"
    LTE = "LTE"
    CONTAINS = "CONTAINS"
    NOT_CONTAINS = "NOT_CONTAINS"
    IN = "IN"
    NOT_IN = "NOT_IN"
    BETWEEN = "BETWEEN"
    MATCHES = "MATCHES"


class FieldDef(CamelModel):
    key: str
    label: str
    type: FieldType = FieldType.STRING
    description: str | None = None

    @field_validator("key")
    @classmethod
    def key_snake(cls, v: str) -> str:
        if not SNAKE.match(v):
            raise ValueError(f"field key must be snake_case: {v!r}")
        return v


class RequirementFilter(CamelModel):
    field: str
    operator: FilterOperator
    value: Any = None


class ValidationRule(CamelModel):
    rule: str
    field: str | None = None
    params: dict[str, Any] | None = None


class Geography(CamelModel):
    places: list[str] = Field(default_factory=list)
    scope: str | None = None
    include_subregions: bool = True


class TimeRange(CamelModel):
    from_date: str | None = Field(default=None, alias="from")
    to_date: str | None = Field(default=None, alias="to")
    relative: str | None = None

    model_config = ConfigDict(alias_generator=lambda s: s, populate_by_name=True)


class Requirement(CamelModel):
    objective: str
    entity_type: str
    quantity: int | None = None
    geography: Geography = Field(default_factory=Geography)
    time_range: TimeRange = Field(default_factory=TimeRange)
    filters: list[RequirementFilter] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    fields: list[FieldDef] = Field(min_length=1)
    required_fields: list[str] = Field(default_factory=list)
    optional_fields: list[str] = Field(default_factory=list)
    source_preferences: list[str] = Field(default_factory=list)
    source_restrictions: list[str] = Field(default_factory=list)
    deduplication_keys: list[str] = Field(default_factory=list)
    validation_rules: list[ValidationRule] = Field(default_factory=list)
    output_format: Literal["csv", "json", "xlsx", "unspecified"] = "unspecified"
    ambiguities: list[str] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def cross_validate(self) -> "Requirement":
        keys = [f.key for f in self.fields]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate field keys in requirement")
        partitioned = [k for k in self.required_fields + self.optional_fields if k]
        if sorted(partitioned) != sorted(keys):
            raise ValueError(
                "every field must appear in exactly one of requiredFields or optionalFields"
            )
        unknown_dedup = [k for k in self.deduplication_keys if k not in keys]
        if unknown_dedup:
            raise ValueError(f"deduplicationKeys not present in fields: {unknown_dedup}")
        for r in self.validation_rules:
            if r.field and r.field not in keys:
                raise ValueError(f"validationRule references unknown field: {r.field}")
        return self

    @property
    def validation_status(self) -> str:
        if (
            self.objective.strip()
            and self.entity_type.strip()
            len(self.fields) >= 1
            and not self.missing_information
        ):
            return "valid"
        return "needs_clarification"


class StepType(str, Enum):
    PLAN = "PLAN"
    SEARCH = "SEARCH"
    SCRAPE = "SCRAPE"
    INTERACT = "INTERACT"
    EXTRACT = "EXTRACT"
    TRANSFORM = "TRANSFORM"
    VALIDATE = "VALIDATE"
    DEDUPLICATE = "DEDUPLICATE"
    MERGE = "MERGE"
    VERIFY = "VERIFY"
    SAVE = "SAVE"
    EXPORT = "EXPORT"


RETRYABLE_ERRORS = {"TIMEOUT", "RATE_LIMIT", "TRANSIENT_NETWORK", "SERVER_ERROR"}


class RetryPolicy(CamelModel):
    max_attempts: int = 3
    strategy: Literal["none", "exponential"] = "exponential"
    retryable_errors: list[str] = Field(default_factory=lambda: list(RETRYABLE_ERRORS))

    @field_validator("max_attempts")
    @classmethod
    def attempts_bound(cls, v: int) -> int:
        if not 1 <= v <= 5:
            raise ValueError("maxAttempts must be between 1 and 5")
        return v

    @field_validator("retryable_errors")
    @classmethod
    def retryable_subset(cls, v: list[str]) -> list[str]:
        bad = [e for e in v if e not in RETRYABLE_ERRORS]
        if bad:
            raise ValueError(f"retryableErrors must be a subset of {sorted(RETRYABLE_ERRORS)}")
        return v


class PlanStep(CamelModel):
    key: str
    type: StepType
    depends_on: list[str] = Field(default_factory=list)
    config: dict[str, Any] | None = None
    retry_policy: RetryPolicy = Field(default_factory=RetryPolicy)
    timeout_ms: int = 60_000

    @field_validator("timeout_ms")
    @classmethod
    def timeout_bound(cls, v: int) -> int:
        if not 1_000 <= v <= 300_000:
            raise ValueError("timeoutMs must be between 1000 and 300000")
        return v


class SearchStrategy(CamelModel):
    queries: list[str] = Field(default_factory=list)
    desired_source_count: int | None = None
    maximum_source_count: int | None = None
    max_requests_per_domain_per_minute: int = 20

    @field_validator("queries")
    @classmethod
    def queries_bound(cls, v: list[str]) -> list[str]:
        if len(v) > 30:
            raise ValueError("at most 30 search queries")
        return v

    @field_validator("max_requests_per_domain_per_minute")
    @classmethod
    def rpm_bound(cls, v: int) -> int:
        if not 1 <= v <= 60:
            raise ValueError("maxRequestsPerDomainPerMinute must be between 1 and 60")
        return v


class WorkflowPlan(CamelModel):
    objective: str
    steps: list[PlanStep] = Field(min_length=2, max_length=30)
    search_strategy: SearchStrategy = Field(default_factory=SearchStrategy)
    extraction_schema: dict[str, Any]
    transformations: list[dict[str, Any]] = Field(default_factory=list)
    validation_rules: list[dict[str, Any]] = Field(default_factory=list)
    deduplication_rules: list[dict[str, Any]] = Field(default_factory=list)
    completion_criteria: dict[str, Any] = Field(
        default_factory=lambda: {"requireSourceEvidence": True}
    )
    output_configuration: dict[str, Any] = Field(default_factory=dict)

    @field_validator("extraction_schema")
    @classmethod
    def schema_object(cls, v: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(v, dict) or v.get("type") != "object":
            raise ValueError("extractionSchema must be a JSON Schema object type")
        return v

    @model_validator(mode="after")
    def dag_valid(self) -> "WorkflowPlan":
        keys = [s.key for s in self.steps]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate step keys")
        types = {s.type for s in self.steps}
        if StepType.EXTRACT not in types:
            raise ValueError("plan must contain at least one EXTRACT step")
        if StepType.SAVE not in types:
            raise ValueError("plan must contain at least one SAVE step")
        seen: set[str] = set()
        for step in self.steps:
            for dep in step.depends_on:
                if dep not in seen:
                    raise ValueError(
                        f"step {step.key!r} depends on {dep!r} which is not an earlier step"
                    )
            seen.add(step.key)
        return self


class ExtractedRecord(CamelModel):
    values: dict[str, Any]
    raw_values: dict[str, Any] | None = None
    source_urls: list[str] = Field(default_factory=list)


class QualityIssue(CamelModel):
    rule_code: str
    severity: Literal["INFO", "WARNING", "ERROR"]
    message: str
    field_key: str | None = None


class QualityRecord(CamelModel):
    values: dict[str, Any]
    raw_values: dict[str, Any] | None = None
    is_valid: bool = True
    validation_issues: list[QualityIssue] = Field(default_factory=list)
    confidence: float | None = None
    verification_status: str | None = None
    duplicate_of_key: str | None = None
    source_urls: list[str] = Field(default_factory=list)
    conflicts: list[dict[str, Any]] = Field(default_factory=list)


class CritiqueResult(CamelModel):
    feedback: str
    terminate: bool
    final_response: str | None = None
    decision: Literal["advance", "retry-step", "replan", "terminate"] = "advance"
