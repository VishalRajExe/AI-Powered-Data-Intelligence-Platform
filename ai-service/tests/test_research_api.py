from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.firecrawl.client import FakeInteractiveWeb, FakeWeb, Interaction, Page, SearchHit
from app.llm.client import LlmError, RecordingLlm
from app.main import create_app
from tests.conftest import build_settings

SCHEMA = {
    "type": "object",
    "properties": {
        "jobs": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "company": {"type": "string"},
                    "role": {"type": "string"},
                    "application_url": {"type": "string"},
                },
                "required": ["company", "role", "application_url"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["jobs"],
    "additionalProperties": False,
}

RECORDS = {"jobs": [{"company": "Acme", "role": "Frontend Engineer",
                     "application_url": "https://acme.test/jobs/1"}]}

KEY = "test-only-shared-key-value-0123456789abcdef"


def build_client(settings: Settings, payloads: list) -> TestClient:
    web = FakeWeb(
        search_results=[[SearchHit(url="https://acme.test/jobs/1", title="Acme hiring")]],
        pages={"https://acme.test/jobs/1": Page(url="https://acme.test/jobs/1",
                                                markdown="Remote frontend role at Acme.", status_code=200)},
    )
    return TestClient(create_app(settings, llm=RecordingLlm(payloads), web=web))


def request_body(**overrides) -> dict:
    body = {"topic": "find remote frontend developer jobs in India", "extractionSchema": SCHEMA}
    body.update(overrides)
    return body


def test_research_endpoint_requires_the_shared_key(settings):
    with build_client(settings, []) as client:
        assert client.post("/ai/v1/research", json=request_body()).status_code == 401


def test_research_runs_the_graph_and_returns_camel_case(settings):
    payloads = [
        {"action": "search", "reason": "find postings", "query": "remote frontend jobs India"},
        {"action": "scrape", "reason": "read the posting", "url": "https://acme.test/jobs/1"},
        {"action": "submit", "reason": "have one role"},
        RECORDS,
        {"is_satisfactory": True, "reason": ["a", "b", "c"], "improvement_instructions": ""},
    ]
    with build_client(settings, payloads) as client:
        response = client.post("/ai/v1/research", json=request_body(), headers={"X-API-Key": KEY})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "COMPLETED"
    assert body["records"][0]["values"]["company"] == "Acme"
    assert body["records"][0]["sources"][0]["url"] == "https://acme.test/jobs/1"
    assert "loopsUsed" in body["metadata"]
    assert "missingFields" in body["validation"]
    # The four parts the platform guarantees.
    assert set(body) == {"status", "records", "sources", "metadata", "validation"}


def test_a_schema_that_cannot_be_walked_is_rejected_at_the_boundary(settings):
    broken = {"type": "object", "properties": {}, "additionalProperties": False}
    with build_client(settings, []) as client:
        response = client.post("/ai/v1/research", json=request_body(extractionSchema=broken),
                               headers={"X-API-Key": KEY})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"


def test_a_schema_allowing_extra_fields_is_rejected(settings):
    """Without additionalProperties:false, invented fields would pass validation silently."""
    loose = dict(SCHEMA, additionalProperties=True)
    with build_client(settings, []) as client:
        response = client.post("/ai/v1/research", json=request_body(extractionSchema=loose),
                               headers={"X-API-Key": KEY})
    assert response.status_code == 422


def test_required_naming_a_property_that_does_not_exist_is_rejected(settings):
    mismatched = {
        "type": "object",
        "properties": {"a": {"type": "string"}},
        "required": ["b"],
        "additionalProperties": False,
    }
    with build_client(settings, []) as client:
        response = client.post("/ai/v1/research", json=request_body(extractionSchema=mismatched),
                               headers={"X-API-Key": KEY})
    assert response.status_code == 422


def test_a_vague_topic_is_refused_rather_than_inventing_a_dataset(settings):
    with build_client(settings, []) as client:
        response = client.post("/ai/v1/research", json=request_body(topic="jobs"),
                               headers={"X-API-Key": KEY})
    assert response.status_code == 422


def test_provider_failure_surfaces_as_502_not_a_fake_result(settings):
    with build_client(settings, [LlmError("Gemini request failed: APITimeoutError")]) as client:
        response = client.post("/ai/v1/research", json=request_body(), headers={"X-API-Key": KEY})

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "AI_PROVIDER_UNAVAILABLE"
    assert "APITimeoutError" in response.json()["error"]["message"]


def test_health_stays_public_while_research_is_gated(settings):
    with build_client(settings, []) as client:
        assert client.get("/ai/v1/health").status_code == 200
        assert client.post("/ai/v1/research", json=request_body()).status_code == 401


# ------------------------------------------------------------------ web tool ceiling


def build_client_with(web, settings: Settings, payloads: list) -> TestClient:
    return TestClient(create_app(settings, llm=RecordingLlm(payloads), web=web))


def interactive_web() -> FakeInteractiveWeb:
    return FakeInteractiveWeb(
        search_results=[[SearchHit(url="https://acme.test/jobs/1", title="Acme hiring")]],
        pages={"https://acme.test/jobs/1": Page(url="https://acme.test/jobs/1",
                                                markdown="Acme is hiring.", status_code=200)},
        interactions={"https://acme.test/jobs/1": Interaction(
            url="https://acme.test/jobs/1", prompt="reveal the salary",
            output="18-24 LPA once expanded.", session_id="brw_1")},
    )


def test_a_request_cannot_enable_a_tool_the_service_left_out(settings):
    with build_client(settings, []) as client:
        response = client.post(
            "/ai/v1/research",
            json=request_body(limits={"allowedTools": ["interact"]}),
            headers={"X-API-Key": KEY},
        )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "NO_PERMITTED_WEB_TOOLS"


def test_an_unknown_tool_name_is_a_validation_failure(settings):
    with build_client(settings, []) as client:
        response = client.post(
            "/ai/v1/research",
            json=request_body(limits={"allowedTools": ["crawl"]}),
            headers={"X-API-Key": KEY},
        )

    assert response.status_code == 422
    assert "allowedTools" in response.json()["error"]["details"][0]


def test_a_request_may_narrow_the_enabled_tools(settings):
    payloads = [
        {"action": "search", "reason": "find postings", "query": "remote frontend jobs India"},
        {"action": "submit", "reason": "enough gathered"},
        RECORDS,
        {"is_satisfactory": True, "reason": ["a", "b", "c"], "improvement_instructions": ""},
    ]
    with build_client_with(FakeWeb(
        search_results=[[SearchHit(url="https://acme.test/jobs/1", title="Acme hiring")]],
    ), settings, payloads) as client:
        response = client.post(
            "/ai/v1/research",
            json=request_body(limits={"allowedTools": ["search"]}),
            headers={"X-API-Key": KEY},
        )

    assert response.status_code == 200
    assert response.json()["metadata"]["enabledTools"] == ["search"]


@pytest.mark.parametrize(
    "requested, ceiling, expected",
    [(None, ["search", "scrape"], ["search", "scrape"]),
     (["search", "scrape", "interact"], ["search", "scrape"], ["search", "scrape"]),
     (["search", "interact"], ["search", "scrape", "interact"], ["search", "interact"])],
)
def test_the_intersection_is_reported_back_to_the_caller(requested, ceiling, expected):
    from app.api.v1.research import resolve_limits
    from app.research.contracts import ResearchLimitsRequest

    settings = build_settings(allowed_web_tools=ceiling)
    limits = resolve_limits(ResearchLimitsRequest(allowedTools=requested), settings)
    assert limits.allowed_tools == expected


def test_the_interaction_budget_is_clamped_to_the_service_setting():
    from app.api.v1.research import resolve_limits
    from app.research.contracts import ResearchLimitsRequest

    settings = build_settings(allowed_web_tools=["search", "scrape", "interact"],
                              max_interactions_per_run=2)
    assert resolve_limits(ResearchLimitsRequest(maxInteractionsPerRun=20), settings).max_interactions_per_run == 2
    assert resolve_limits(None, settings).max_interactions_per_run == 2


def test_a_run_with_interact_enabled_completes_over_the_wire(settings):
    payloads = [
        {"action": "search", "reason": "find postings", "query": "remote frontend jobs India"},
        {"action": "scrape", "reason": "read the posting", "url": "https://acme.test/jobs/1"},
        {"action": "interact", "reason": "salary hidden", "url": "https://acme.test/jobs/1",
         "prompt": "reveal the salary"},
        {"action": "submit", "reason": "have the salary"},
        {"jobs": [{"company": "Acme", "role": "Frontend Engineer",
                   "application_url": "https://acme.test/jobs/1", "salary": "18-24 LPA"}]},
        {"is_satisfactory": True, "reason": ["fields present", "urls observed", "one role"],
         "improvement_instructions": ""},
    ]
    enabled = build_settings(allowed_web_tools=["search", "scrape", "interact"],
                             max_interactions_per_run=2)
    # The job schema must declare the field the run is asked for, or gate 1 rejects the extra.
    schema_with_salary = {
        "type": "object",
        "properties": {
            "jobs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "company": {"type": "string"},
                        "role": {"type": "string"},
                        "application_url": {"type": "string"},
                        "salary": {"type": "string"},
                    },
                    "required": ["company", "role", "application_url"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["jobs"],
        "additionalProperties": False,
    }

    with build_client_with(interactive_web(), enabled, payloads) as client:
        response = client.post("/ai/v1/research",
                               json=request_body(extractionSchema=schema_with_salary),
                               headers={"X-API-Key": KEY})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "COMPLETED"
    assert body["metadata"]["interactionsUsed"] == 1
    assert body["metadata"]["enabledTools"] == ["search", "scrape", "interact"]
    assert body["sources"][0]["sourceType"] == "search+scrape+interact"
