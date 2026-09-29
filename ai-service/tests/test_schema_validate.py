from __future__ import annotations

from app.extraction.schema_validate import (
    coerce_to_json,
    field_checklist,
    strip_const,
    to_gemini_schema,
    validate_against_schema,
)

STARTUP_SCHEMA = {
    "type": "object",
    "properties": {
        "records": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "company_name": {"type": "string"},
                    "website": {"type": "string"},
                    "funding_usd": {"type": "number"},
                },
                "required": ["company_name", "website"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["records"],
    "additionalProperties": False,
}


def test_reports_missing_required_field_by_path():
    data = {"records": [{"company_name": "Acme", "website": "https://acme.test"}]}
    assert validate_against_schema(STARTUP_SCHEMA, data).ok is True


def test_array_is_validated_item_by_item_not_just_the_first():
    data = {"records": [
        {"company_name": "One", "website": "https://one.test"},
        {"company_name": "Two"},
    ]}
    result = validate_against_schema(STARTUP_SCHEMA, data)
    assert result.ok is False
    assert "records[1].website" in result.missing


def test_empty_string_counts_as_missing():
    """A blank field is not evidence of anything; upstream treated it the same way."""
    data = {"records": [{"company_name": "   ", "website": "https://one.test"}]}
    assert "records[0].company_name" in validate_against_schema(STARTUP_SCHEMA, data).missing


def test_empty_array_counts_as_missing():
    """Nothing was collected, which is not a schema-satisfying answer."""
    assert "records[]" in validate_against_schema(STARTUP_SCHEMA, {"records": []}).missing


def test_unexpected_keys_are_reported_with_their_path():
    data = {"records": [{"company_name": "One", "website": "https://x.test", "ceo": "Nobody"}]}
    result = validate_against_schema(STARTUP_SCHEMA, data)
    assert "records[0].ceo" in result.extra
    assert result.ok is False


def test_optional_field_absent_is_fine_but_present_and_empty_is_not():
    schema = {
        "type": "object",
        "properties": {"a": {"type": "string"}, "b": {"type": "string"}},
        "required": ["a"],
        "additionalProperties": False,
    }
    assert validate_against_schema(schema, {"a": "x"}).ok is True
    assert "b" in validate_against_schema(schema, {"a": "x", "b": ""}).missing


def test_nested_object_paths_are_dotted():
    schema = {
        "type": "object",
        "properties": {
            "company": {
                "type": "object",
                "properties": {"name": {"type": "string"}, "hq": {"type": "string"}},
                "required": ["name", "hq"],
                "additionalProperties": False,
            }
        },
        "required": ["company"],
        "additionalProperties": False,
    }
    result = validate_against_schema(schema, {"company": {"name": "Acme"}})
    assert result.missing == ["company.hq"]


def test_checklist_renders_leaf_paths_for_prompting():
    paths = field_checklist(STARTUP_SCHEMA)
    assert paths == ["records[].company_name", "records[].website", "records[].funding_usd"]


def test_checklist_marks_primitive_arrays_as_get_all_items():
    schema = {"type": "object", "properties": {"tags": {"type": "array", "items": {"type": "string"}}}}
    assert field_checklist(schema) == ["tags[] (get ALL items)"]


def test_non_object_schema_is_rejected_rather_than_passing_vacuously():
    assert validate_against_schema("not a schema", {"a": 1}).missing


def test_coerce_to_json_handles_stringified_payloads():
    assert coerce_to_json('{"a": 1}') == {"a": 1}
    assert coerce_to_json("   ") is None
    assert coerce_to_json("not json") is None
    assert coerce_to_json(None) is None
    assert coerce_to_json({"a": 1}) == {"a": 1}


def test_strip_const_replaces_const_with_enum():
    """Gemini rejects `const` inside a response schema (agent-core/README.md:399-401)."""
    scrubbed = strip_const({
        "type": "object",
        "properties": {"kind": {"const": "startup"}},
        "additionalProperties": False,
    })
    assert "const" not in scrubbed["properties"]["kind"]
    assert scrubbed["properties"]["kind"]["enum"] == ["startup"]


def test_strip_const_recurses_into_arrays():
    scrubbed = strip_const({"type": "array", "items": {"type": "object",
                                                        "properties": {"a": {"const": "x"}}}})
    assert "const" not in scrubbed["items"]["properties"]["a"]


def test_gemini_projection_drops_additional_properties():
    """Gemini answers 400 INVALID_ARGUMENT for `additionalProperties`, while gate 1 needs it.

    The strict schema stays the internal contract; only the copy sent to the provider is
    projected. Verified against the live API in tests/test_live_requirements.py.
    """
    projected = to_gemini_schema(STARTUP_SCHEMA)

    assert "additionalProperties" not in projected
    assert "additionalProperties" not in projected["properties"]["records"]
    assert "additionalProperties" not in projected["properties"]["records"]["items"]
    assert "additionalProperties" in STARTUP_SCHEMA, "the internal contract is not weakened"
    assert projected["properties"]["records"]["items"]["properties"]["company_name"]["type"] == "string"
