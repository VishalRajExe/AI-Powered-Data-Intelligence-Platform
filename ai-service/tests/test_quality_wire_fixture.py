"""The wire fixture Spring Boot reads, pinned on the side that produces it.

`backend/src/test/java/ai/finalagent/aiclient/QualityWireContractTest.java` deserializes the
`response` object in `backend/src/test/resources/wire/quality-process.json` into its DTOs. A
captured file only proves something if the producer is held to it, so this test recomputes the
same payload from the live pipeline and compares. Without it the fixture would silently age: the
Python model could rename a field, the Java test would keep reading the old snapshot, and the two
services would drift while both suites stayed green.

Regenerate deliberately, never by accident:

    FINALAGENT_UPDATE_QUALITY_FIXTURE=true pytest -q tests/test_quality_wire_fixture.py
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

from app.contracts import ValidationRule
from app.quality.contracts import QualityRequest, SourceRef
from app.quality.pipeline import process
from tests.conftest import build_settings

FIXTURE_PATH = (Path(__file__).resolve().parents[2]
                / "backend" / "src" / "test" / "resources" / "wire" / "quality-process.json")

SETTING = build_settings()


def _source(url: str, *, verified: bool = True, stamp: str = "2026-02-01T09:00:00Z",
            title: str = "") -> dict[str, Any]:
    return SourceRef(url=url, title=title or url.rsplit("/", 1)[-1], sourceType="scrape",
                     retrievedAt=stamp, verifiedByTool=verified).model_dump(mode="json",
                                                                            by_alias=True)


def request_payload() -> dict[str, Any]:
    """One request that reaches every part of the response the Java side has to bind.

    The shapes are chosen for their wire properties, not for realism: a currency object, an
    ambiguous decimal that must stay text, a linked duplicate, an entity merge that records a
    conflict, a record whose only citation was never retrieved, a key outside the declared
    contract, and a null confidence next to a computed quality score.
    """
    fields = [
        {"key": "company_name", "label": "Company", "type": "STRING", "required": True},
        {"key": "website", "label": "Website", "type": "URL"},
        {"key": "contact_email", "label": "Contact", "type": "EMAIL"},
        {"key": "last_round", "label": "Last round", "type": "CURRENCY"},
        {"key": "employee_count", "label": "Employees", "type": "NUMBER"},
        {"key": "founded", "label": "Founded", "type": "DATE"},
        {"key": "hiring", "label": "Hiring", "type": "BOOLEAN"},
    ]
    records = [
        {
            "values": {
                "company_name": "Northwind Labs",
                "website": "https://northwind.test",
                "contact_email": "hello@northwind.test",
                "last_round": {"amount": "4.5M", "currency": "USD"},
                "employee_count": 42,
                "founded": "2019",
                "hiring": True,
                "source_page": "Series B announcement",
            },
            "sources": [_source("https://northwind.test/about", verified=True),
                        _source("https://techcrunch.test/northwind-b", verified=True)],
        },
        {
            # Same website as the record above: exact-URL deduplication links it, it is not deleted.
            "values": {
                "company_name": "northwind labs ",
                "website": "https://northwind.test/",
                "employee_count": "39",
            },
            "sources": [_source("https://northwind.test/careers", verified=True)],
        },
        {
            # A different page, a different name, one shared email: entity resolution merges on the
            # identifier and records the disagreement about the round rather than picking silently.
            "values": {
                "company_name": "Northwind Robotics",
                "website": "https://northwind-robotics.test",
                "contact_email": "HELLO@northwind.test ",
                "last_round": {"amount": 6_000_000, "currency": "usd"},
                "employee_count": "79,90",
            },
            "sources": [_source("https://linkedin.test/company/northwind", verified=True,
                                stamp="2026-02-03T09:00:00Z")],
        },
        {
            # Cited, but nothing in this run retrieved it: Java must be able to see that.
            "values": {
                "company_name": "Vantage Grid",
                "website": "https://vantagegrid.test",
                "last_round": {"amount": 1_200_000, "currency": "EUR"},
            },
            "sources": [_source("https://twitter.test/vantagegrid", verified=False)],
        },
        {
            # The model asserted a company with nothing cited. No sources at all, so confidence
            # has to stay null: a zero would read as "weak evidence" when the truth is "none",
            # and the difference is the reason the field is nullable in both languages.
            "values": {"company_name": "Halcyon Optics", "website": "https://halcyonoptics.test"},
            "sources": [],
        },
        {
            # No required field at all: invalid, still present, with the issue attached.
            "values": {"website": "not a url", "founded": "05/11/2024"},
            "sources": [_source("https://directory.test/listing-77", verified=True)],
        },
    ]
    return {
        "entityType": "funded_company",
        "objective": "list funded European deep-tech companies with their last round",
        "fields": fields,
        "requiredFields": ["company_name"],
        "deduplicationKeys": ["website"],
        "validationRules": [
            ValidationRule(rule="min", field="employee_count", params={"value": 1}).model_dump(
                mode="json", by_alias=True),
            ValidationRule(rule="url_live", field="website", params={}).model_dump(
                mode="json", by_alias=True),
        ],
        "extractionSchema": {
            "type": "object",
            "properties": {
                "records": {"type": "array", "items": {
                    "type": "object",
                    "properties": {field["key"]: {"type": "string"} for field in fields},
                    "additionalProperties": False}},
            },
            "additionalProperties": False,
        },
        "records": records,
        "rawRecordCount": len(records),
    }


def rendered() -> dict[str, Any]:
    result = process(QualityRequest.model_validate(request_payload()), SETTING)
    return {
        "generatedBy": "ai-service/tests/test_quality_wire_fixture.py",
        "regenerate": "FINALAGENT_UPDATE_QUALITY_FIXTURE=true pytest -q "
                      "tests/test_quality_wire_fixture.py",
        "request": request_payload(),
        "response": result.model_dump(mode="json", by_alias=True),
    }


def wire_cases(payload: dict[str, Any]) -> dict[str, bool]:
    """The properties the Java DTO has to bind, read out of the serialized document."""
    records = payload["records"]
    by_index = {record["index"]: record for record in records}
    return {
        "isValid binds as a real field": all("isValid" in record for record in records),
        "a record is valid": any(record["isValid"] for record in records),
        "a record is invalid": any(not record["isValid"] for record in records),
        "verifiedByTool survives": any(
            source["verifiedByTool"] for record in records for source in record["sources"]),
        "an unverified source is kept, not filtered": any(
            not source["verifiedByTool"] for record in records for source in record["sources"]),
        "a duplicate is linked, not deleted": any(
            record.get("duplicateOf") is not None for record in records),
        "a conflict carries both values": any(
            conflict["rejectedValue"] is not None
            for record in records for conflict in record["conflicts"]),
        "a conflict names its rule": all(
            conflict["resolvedBy"]
            for record in records for conflict in record["conflicts"]),
        "currency is an object with an amount": any(
            isinstance(value, dict) and value.get("amount") is not None
            for record in records for key, value in record["values"].items()
            if key == "last_round"),
        "an ambiguous decimal stayed text": any(
            isinstance(value, str) and "," in value
            for record in records for value in record["values"].values()),
        "a key outside the contract is reported": bool(
            stages(payload)["normalize"]["metrics"]["keysOutsideTheContract"]),
        "a record citing nothing has a null confidence": any(
            not record["sources"] and record.get("confidence") is None for record in records),
        "confidence is nullable": any(
            record.get("confidence") is None for record in records),
        "the dataset has columns and rows": bool(payload["dataset"]["columns"]) and bool(
            payload["dataset"]["rows"]),
        "every input record is accounted for": sorted(by_index) == list(range(len(records))),
        "the score names its own formula": bool(payload["quality"]["scoreBasis"]),
    }


def stages(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {stage["stage"]: stage for stage in payload["stages"]}


def test_the_fixture_still_matches_what_the_pipeline_produces():
    """The pin: if this fails, the Java test is reading a snapshot of an older contract."""
    document = rendered()
    if os.environ.get("FINALAGENT_UPDATE_QUALITY_FIXTURE") == "true":
        FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE_PATH.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n",
                                encoding="utf-8")
        pytest.skip("fixture regenerated")

    assert FIXTURE_PATH.exists(), (
        f"{FIXTURE_PATH} is missing; regenerate it with "
        f"FINALAGENT_UPDATE_QUALITY_FIXTURE=true pytest -q tests/test_quality_wire_fixture.py")
    stored = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    assert stored["response"] == document["response"], (
        "the committed wire fixture no longer equals what the pipeline produces, so Spring's "
        "contract test is checking an old shape; regenerate it and re-run the Java suite too")
    assert stored["request"] == document["request"]


def test_the_fixture_carries_every_shape_the_java_dto_has_to_bind():
    document = rendered()
    cases = wire_cases(document["response"])
    assert cases == {key: True for key in cases}, [key for key, passed in cases.items()
                                                   if not passed]
    assert document["response"]["status"] in ("COMPLETED", "COMPLETED_WITH_WARNINGS")


def test_the_declared_field_types_come_back_as_the_columns_they_were_declared_as():
    """A type that silently became STRING is how a currency amount stopped being an amount."""
    columns = {column["key"]: column["type"] for column in rendered()["response"]["dataset"]["columns"]}
    for key, expected in {"last_round": "CURRENCY", "website": "URL",
                          "contact_email": "EMAIL", "employee_count": "NUMBER",
                          "founded": "DATE", "hiring": "BOOLEAN",
                          "company_name": "STRING"}.items():
        assert columns.get(key) == expected
