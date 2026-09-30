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
            and len(self.fields) >= 1
            and not self.missing_information
        ):
            return "valid"
        return "needs_clarification"


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


class QualityIssue(CamelModel):
    rule_code: str
    severity: Literal["INFO", "WARNING", "ERROR"]
    message: str
    field_key: str | None = None


class PromptRequest(CamelModel):
    """A request whose input is the user's own words.

    `min_length` alone would accept 8 spaces, so the two endpoints that take a prompt share this
    rather than each carrying its own copy of the check.
    """

    prompt: str = Field(min_length=8, max_length=4000)

    @field_validator("prompt")
    @classmethod
    def prompt_is_real_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("prompt must contain real text")
        return value.strip()
