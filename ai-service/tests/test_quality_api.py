"""`POST /ai/v1/quality/process` as a wire contract.

The pipeline itself is tested in `test_quality_pipeline.py`; what matters here is the boundary:
authentication, the camelCase shape Spring binds against, the request bounds that are refused with
422 rather than clamped, and the fact that this endpoint never reaches a provider.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.curation.robots import StaticRobots
from app.firecrawl.client import FakeWeb
from app.llm.client import RecordingLlm
from app.main import create_app
from tests.conftest import build_settings

KEY = "test-only-shared-key-value-0123456789abcdef"
HEADERS = {"X-API-Key": KEY}

BODY = {
    "entityType": "youtube_channel",
    "objective": "list coding channels",
    "extractionSchema": {"type": "object", "properties": {}},
    "fields": [
        {"key": "channel_name", "label": "Channel", "type": "STRING", "required": True},
        {"key": "channel_url", "label": "URL", "type": "URL"},
        {"key": "subscribers", "label": "Subscribers", "type": "NUMBER"},
    ],
    "requiredFields": ["channel_name"],
    "deduplicationKeys": ["channel_url"],
    "validationRules": [{"rule": "min", "field": "subscribers", "params": {"min": 100}}],
    "rawRecordCount": 2,
    "records": [
        {"values": {"channel_name": "Coding Cat",
                    "channel_url": "https://youtube.com/@codingcat?si=q", "subscribers": "312k"},
         "sources": [{"url": "https://youtube.com/@codingcat", "title": "Coding Cat",
                     "sourceType": "search+scrape", "retrievedAt": "2026-01-01T00:00:00Z",
                     "verifiedByTool": True}]},
        {"values": {"channel_name": "Tiny", "channel_url": "https://youtube.com/@tiny",
                    "subscribers": "12"},
         "sources": []},
    ],
}


def client_with() -> tuple[TestClient, RecordingLlm, FakeWeb]:
    llm = RecordingLlm([])
    web = FakeWeb()
    client = TestClient(create_app(build_settings(), llm=llm, web=web,
                                   robots=lambda: StaticRobots()))
    return client, llm, web


def test_the_endpoint_requires_the_shared_key():
    client, _, _ = client_with()

    assert client.post("/ai/v1/quality/process", json=BODY).status_code == 401
    wrong = client.post("/ai/v1/quality/process", json=BODY, headers={"X-API-Key": "nope" * 12})
    assert wrong.status_code == 401
    assert wrong.json()["error"]["code"] == "UNAUTHENTICATED"


def test_a_valid_batch_returns_the_advisory_result_without_touching_a_provider():
    client, llm, web = client_with()

    response = client.post("/ai/v1/quality/process", json=BODY, headers=HEADERS)

    assert response.status_code == 200, response.text
    # The pipeline is arithmetic over records. If it ever reaches for the model or the web, this
    # assertion fails first: `RecordingLlm` has no payloads and raises on any call, and FakeWeb
    # records every search and scrape it is asked for.
    assert llm.calls == []
    assert web.search_calls == []
    assert web.scrape_calls == []

    body = response.json()
    assert [stage["stage"] for stage in body["stages"]] == [
        "normalize", "validate", "deduplicate", "resolve", "merge", "score"]
    assert body["quality"]["rawCount"] == 2
    assert body["quality"]["validCount"] == 1
    assert body["quality"]["invalidCount"] == 1
    assert [column["key"] for column in body["dataset"]["columns"]][:3] == [
        "channel_name", "channel_url", "subscribers"]
    assert len(body["dataset"]["rows"]) == 2


def test_the_response_shape_is_camelCase_because_java_binds_it_field_for_field():
    client, _, _ = client_with()

    body = client.post("/ai/v1/quality/process", json=BODY, headers=HEADERS).json()

    record = body["records"][0]
    for key in ("index", "values", "rawValues", "sources", "isValid", "issues",
                "verificationStatus", "evidence", "duplicateOf", "reviewRequired",
                "reviewReasons", "conflicts", "normalizationNotes"):
        assert key in record, key
    assert "source_count" not in str(body)
    assert "raw_values" not in str(body)
    assert record["sources"][0]["verifiedByTool"] is True
    assert record["evidence"]["verifiedSourceCount"] == 1


def test_an_unverified_and_an_out_of_range_record_both_come_back_flagged():
    client, _, _ = client_with()

    body = client.post("/ai/v1/quality/process", json=BODY, headers=HEADERS).json()

    tiny = next(record for record in body["records"] if record["values"]["channel_name"] == "Tiny")
    assert tiny["isValid"] is False
    assert {issue["ruleCode"] for issue in tiny["issues"]} == {"SOURCE_EVIDENCE", "RANGE"}
    assert tiny["verificationStatus"] == "UNSUPPORTED"
    # Absent evidence produces no confidence, not a low one.
    assert tiny["confidence"] is None


def test_out_of_range_bounds_are_refused_rather_than_silently_clamped():
    client, _, _ = client_with()

    loose = dict(BODY, entityMatchThreshold=0.2)
    response = client.post("/ai/v1/quality/process", json=loose, headers=HEADERS)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"

    tiny_block = dict(BODY, maxBlockSize=1)
    assert client.post("/ai/v1/quality/process", json=tiny_block, headers=HEADERS).status_code == 422


def test_a_record_set_the_caller_narrowed_by_hand_is_respected_over_the_service_default():
    client, _, _ = client_with()
    body = dict(BODY, entityMatchThreshold=0.99)

    result = client.post("/ai/v1/quality/process", json=body, headers=HEADERS).json()

    resolve = next(stage for stage in result["stages"] if stage["stage"] == "resolve")
    assert resolve["metrics"]["threshold"] == 0.99


def test_an_empty_batch_is_an_empty_dataset_and_not_an_error():
    client, _, _ = client_with()
    body = dict(BODY, records=[], rawRecordCount=0)

    response = client.post("/ai/v1/quality/process", json=body, headers=HEADERS)

    assert response.status_code == 200
    result = response.json()
    assert result["dataset"]["rows"] == []
    assert result["quality"]["qualityScore"] is None
    assert any("no records" in warning for warning in result["warnings"])
