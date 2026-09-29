"""Natural-language requirement → structured requirement → dynamic extraction schema.

Two separate artifacts, deliberately not conflated:

* the **requirement** is what the user asked for (objective, entity, quantity, filters,
  geography, dates, sources, dedup keys, validation rules);
* the **extraction schema** is what the research graph must fill.

The extraction schema is *derived* from the requirement's own field list. Nothing in this
module names a company, channel, job, founder or funding round: change the request and the
generated schema changes, which is the whole point of the platform and the specific defect
(`00-FORENSIC-AUDIT.md` §1) this rebuild exists to remove.
"""
from __future__ import annotations

from typing import Any

from app.contracts import Requirement

RECORDS_KEY = "records"

# Gemini's response_schema rejects `const` and copes badly with `$ref`/`$defs`, so the
# schema below is written flat and inline rather than generated from the Pydantic model.
# `FilterValue` is a string by design: the model states a constraint in words and the
# quality phase coerces it, rather than inventing a type union the provider must guess at.
REQUIREMENT_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "requirement": {
            "type": "object",
            "properties": {
                "objective": {
                    "type": "string",
                    "description": "One sentence stating what collection result the user wants.",
                },
                "entity_type": {
                    "type": "string",
                    "description": "The kind of thing being collected, e.g. 'youtube_channel', "
                                   "'company', 'job'. Lower snake_case. Never a default — derive it "
                                   "from the request.",
                },
                "quantity": {
                    "type": "integer",
                    "description": "How many entities the user asked for. Omit when unstated.",
                },
                "fields": {
                    "type": "array",
                    "description": "The attributes to collect for each entity. Derived from the "
                                   "request, not from a fixed template. If the user names none, "
                                   "choose 4-8 attributes that genuinely suit this entity type.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "key": {"type": "string", "description": "snake_case identifier"},
                            "label": {"type": "string", "description": "Human-readable column name"},
                            "type": {
                                "type": "string",
                                "enum": ["STRING", "NUMBER", "BOOLEAN", "DATE", "DATETIME", "URL",
                                         "EMAIL", "PHONE", "CURRENCY", "JSON"],
                            },
                            "description": {
                                "type": "string",
                                "description": "What counts as a correct value for this field, "
                                               "including units or format where relevant.",
                            },
                        },
                        "required": ["key", "label", "type"],
                        "additionalProperties": False,
                    },
                },
                "required_fields": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Field keys the result is useless without. Every field key must "
                                   "appear in exactly one of requiredFields / optionalFields.",
                },
                "optional_fields": {"type": "array", "items": {"type": "string"}},
                "filters": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "field": {"type": "string"},
                            "operator": {
                                "type": "string",
                                "enum": ["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "CONTAINS", "IN",
                                         "NOT_IN", "BETWEEN"],
                            },
                            "value": {"type": "string", "description": "The constraint stated in words"},
                        },
                        "required": ["field", "operator"],
                        "additionalProperties": False,
                    },
                },
                "constraints": {"type": "array", "items": {"type": "string"}},
                "geography": {
                    "type": "object",
                    "properties": {
                        "places": {"type": "array", "items": {"type": "string"}},
                        "scope": {"type": "string"},
                        "include_subregions": {"type": "boolean"},
                    },
                    "required": ["places"],
                    "additionalProperties": False,
                },
                "time_range": {
                    "type": "object",
                    "properties": {
                        "from": {"type": "string", "description": "ISO date, e.g. 2020-01-01"},
                        "to": {"type": "string"},
                        "relative": {"type": "string", "description": "e.g. 'founded after 2020'"},
                    },
                    "additionalProperties": False,
                },
                "source_preferences": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Where the user wants data taken from, if they said so.",
                },
                "source_restrictions": {"type": "array", "items": {"type": "string"}},
                "deduplication_keys": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Field keys that identify the same entity twice. Must be field keys.",
                },
                "validation_rules": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "rule": {"type": "string", "enum": ["REQUIRED", "TYPE", "URL", "EMAIL",
                                                                "DATE", "RANGE", "ENUM", "CUSTOM"]},
                            "field": {"type": "string"},
                        },
                        "required": ["rule"],
                        "additionalProperties": False,
                    },
                },
                "output_format": {
                    "type": "string",
                    "enum": ["csv", "json", "xlsx", "unspecified"],
                },
                "ambiguities": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Parts of the request with more than one reasonable reading.",
                },
                "missing_information": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Information required to proceed that the request does not "
                                   "contain at all. Non-empty means the run must stop and ask.",
                },
                "warnings": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["objective", "entity_type", "fields", "required_fields", "optional_fields"],
            "additionalProperties": False,
        },
        "search_queries": {
            "type": "array",
            "maxItems": 6,
            "items": {"type": "string"},
            "description": "Concrete web searches that would surface this data. Specific to the "
                           "entity, geography and constraints; no generic single-word queries.",
        },
        "clarification_questions": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Up to three questions that would remove the blocking ambiguity.",
        },
    },
    "required": ["requirement", "search_queries"],
    "additionalProperties": False,
}

# Decoding must stay strict, so complex field types are flattened to text on purpose rather
# than left as free-form objects the validator could not check.
_TYPE_MAP: dict[str, str] = {
    "STRING": "string",
    "URL": "string",
    "EMAIL": "string",
    "PHONE": "string",
    "DATE": "string",
    "DATETIME": "string",
    "NUMBER": "number",
    "CURRENCY": "number",
    "BOOLEAN": "boolean",
    "JSON": "string",
}

_FORMAT_HINT: dict[str, str] = {
    "URL": "Give the absolute http(s) URL.",
    "EMAIL": "Give a full email address.",
    "PHONE": "Give the number in international format.",
    "DATE": "Use YYYY-MM-DD.",
    "DATETIME": "Use ISO-8601.",
    "CURRENCY": "Give the numeric amount only, in US dollars, without symbols or separators.",
    "JSON": "Give a JSON string.",
    "BOOLEAN": "true or false.",
}


def derive_extraction_schema(requirement: Requirement) -> dict[str, Any]:
    """Build the JSON Schema the research graph must satisfy.

    Every property comes from the requirement's own fields. `source_url` is added to each
    record because the graph attributes cited URLs against sources it actually fetched —
    a record citing a page nobody retrieved is reported, not passed off.
    """
    properties: dict[str, Any] = {}
    for field in requirement.fields:
        entry: dict[str, Any] = {"type": _TYPE_MAP.get(field.type.value, "string")}
        hints = [part for part in (field.label, field.description, _FORMAT_HINT.get(field.type.value, "")) if part]
        if hints:
            entry["description"] = " — ".join(dict.fromkeys(hints))
        properties[field.key] = entry

    properties["source_url"] = {
        "type": "string",
        "description": "The page this record's values were read from. Must be a URL actually "
                       "retrieved during this run.",
    }

    # A record with nothing required could be satisfied by `{}`, which would make gate 1
    # pass vacuously. When the user names no mandatory field, fall back to the identity
    # keys the requirement itself declares — never to `source_url`, and never to all fields,
    # which would guarantee a repair loop on any run with optional data.
    required = [key for key in (requirement.required_fields or []) if key in properties]
    if not required:
        fallback = [key for key in (requirement.deduplication_keys or []) if key in properties]
        required = fallback or [field.key for field in requirement.fields[:2] if field.key in properties]

    return {
        "type": "object",
        "properties": {
            RECORDS_KEY: {
                "type": "array",
                "description": f"One entry per {requirement.entity_type} found.",
                "items": {
                    "type": "object",
                    "properties": properties,
                    "required": required or list(properties),
                    "additionalProperties": False,
                },
            }
        },
        "required": [RECORDS_KEY],
        "additionalProperties": False,
    }


def expected_records(requirement: Requirement) -> int | None:
    return requirement.quantity


def build_research_brief(requirement: Requirement) -> str:
    """Turn the structured requirement into the objective text the graph is given.

    This is how a prompt changes what is collected: geography, dates, filters and source
    wishes travel to the model as constraints on the search, not as UI decoration.
    """
    parts = [requirement.objective.strip(), f"Entity type: {requirement.entity_type}."]

    if requirement.quantity:
        parts.append(f"Collect at least {requirement.quantity} distinct {requirement.entity_type} records.")

    places = ", ".join(requirement.geography.places)
    if places:
        scope = f" ({requirement.geography.scope})" if requirement.geography.scope else ""
        parts.append(f"Geographic scope: {places}{scope}.")
    if requirement.geography.places and not requirement.geography.include_subregions:
        parts.append("Do not widen the search to neighbouring regions.")

    if requirement.time_range.relative:
        parts.append(f"Time constraint: {requirement.time_range.relative}.")
    if requirement.time_range.from_date:
        parts.append(f"Not earlier than {requirement.time_range.from_date}.")
    if requirement.time_range.to_date:
        parts.append(f"Not later than {requirement.time_range.to_date}.")

    for flt in requirement.filters:
        parts.append(f"Filter: {flt.field} {flt.operator.value} {flt.value}." if flt.value
                     else f"Filter: {flt.field} {flt.operator.value}.")

    parts.extend(requirement.constraints)

    if requirement.source_preferences:
        parts.append("Prefer these sources: " + ", ".join(requirement.source_preferences) + ".")
    if requirement.source_restrictions:
        parts.append("Avoid these sources: " + ", ".join(requirement.source_restrictions) + ".")

    fields = ", ".join(field.key for field in requirement.fields)
    parts.append(f"Fields to evidence per record: {fields}.")

    return "\n".join(part for part in parts if part)
