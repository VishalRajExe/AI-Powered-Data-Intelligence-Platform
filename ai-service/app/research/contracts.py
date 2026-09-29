"""Wire contract for the research graph, shared with the Spring Boot backend.

Field names serialize to camelCase so the Java DTO mirrors them field-for-field.

Input validation is deliberately strict about the extraction schema: the graph's gate 1
walks a JSON Schema, and a caller passing an example-shaped object or an empty property
set would produce a validation result that silently means nothing.
"""
from __future__ import annotations

from typing import Any

from pydantic import Field, field_validator, model_validator

from app.config import KNOWN_WEB_TOOLS
from app.contracts import CamelModel


class ResearchLimitsRequest(CamelModel):
    max_loops: int | None = Field(default=None, ge=1, le=20)
    max_search_results: int | None = Field(default=None, ge=1, le=20)
    max_searches_per_run: int | None = Field(default=None, ge=1, le=100)
    max_scrapes_per_run: int | None = Field(default=None, ge=1, le=100)
    max_interactions_per_run: int | None = Field(default=None, ge=0, le=20)
    expected_records: int | None = Field(default=None, ge=1, le=5000)
    allowed_domains: list[str] = Field(default_factory=list)
    blocked_domains: list[str] = Field(default_factory=list)
    # Which web tools this run wants. The service intersects it with ALLOWED_WEB_TOOLS, so
    # a request can narrow the set but never widen it — `interact` is operator-enabled.
    allowed_tools: list[str] | None = Field(default=None, min_length=1)

    @field_validator("allowed_tools")
    @classmethod
    def _known_tools(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        normalised = [str(tool).strip().lower() for tool in value]
        unknown = sorted({tool for tool in normalised if tool not in KNOWN_WEB_TOOLS})
        if unknown:
            raise ValueError(
                f"allowedTools names unknown web tools: {unknown}; known: {sorted(KNOWN_WEB_TOOLS)}"
            )
        return normalised


class ResearchRequest(CamelModel):
    """`topic` + a dynamically generated `extractionSchema` — the template's own entry
    shape, extended with the bounds and domain policy this platform enforces."""

    topic: str = Field(min_length=8, max_length=2000)
    extraction_schema: dict[str, Any]
    limits: ResearchLimitsRequest | None = None
    seed_queries: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("topic")
    @classmethod
    def _topic_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("topic must contain real text")
        return value.strip()

    @field_validator("extraction_schema")
    @classmethod
    def _schema_is_walkable(cls, value: dict[str, Any]) -> dict[str, Any]:
        if value.get("type") != "object":
            raise ValueError("extractionSchema.type must be 'object' — the contract describes one result")
        properties = value.get("properties")
        if not isinstance(properties, dict) or not properties:
            raise ValueError(
                "extractionSchema.properties must declare at least one field; an empty schema would make "
                "validation pass vacuously"
            )
        if value.get("additionalProperties") is not False:
            raise ValueError("extractionSchema must set additionalProperties:false so invented fields are caught")
        return value

    @model_validator(mode="after")
    def _cross_check(self) -> "ResearchRequest":
        required = self.extraction_schema.get("required") or []
        properties = self.extraction_schema.get("properties") or {}
        unknown = [name for name in required if name not in properties]
        if unknown:
            raise ValueError(f"extractionSchema.required names undeclared properties: {unknown}")
        return self
