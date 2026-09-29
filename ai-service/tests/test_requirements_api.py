from __future__ import annotations

from fastapi.testclient import TestClient

from app.curation.robots import StaticRobots
from app.firecrawl.client import FakeWeb, Page, SearchHit
from app.llm.client import RecordingLlm
from app.main import create_app

KEY = "test-only-shared-key-value-0123456789abcdef"

# Duplicated rather than imported from another test module: the tests directory is not a package.
CHANNELS = {
    "requirement": {
        "objective": "List popular YouTube channels that teach programming",
        "entityType": "youtube_channel",
        "quantity": 20,
        "fields": [
            {"key": "channel_name", "label": "Channel name", "type": "STRING"},
            {"key": "channel_url", "label": "Channel URL", "type": "URL"},
            {"key": "focus_area", "label": "Focus", "type": "STRING"},
            {"key": "subscribers", "label": "Subscribers", "type": "NUMBER"},
        ],
        "requiredFields": ["channel_name", "channel_url"],
        "optionalFields": ["focus_area", "subscribers"],
        "geography": {"places": []},
        "deduplicationKeys": ["channel_url"],
    },
    "search_queries": ["best coding youtube channels", "python tutorials channels"],
}


def client_with(settings, payloads, web=None) -> TestClient:
    return TestClient(create_app(
        settings,
        llm=RecordingLlm(payloads),
        web=web or FakeWeb(
            search_results=[[SearchHit(url="https://youtube.test/c/cat", title="Coding Cat")]],
            pages={"https://youtube.test/c/cat": Page(url="https://youtube.test/c/codingcat",
                                                      markdown="python tutorials channel",
                                                      status_code=200)},
        ),
        # These tests follow the requirement → contract → collection chain. The robots gate is
        # exercised deliberately in tests/test_curation.py, not as a DNS accident here.
        robots=lambda: StaticRobots(),
    ))


def test_analyze_endpoint_requires_the_key(settings):
    with client_with(settings, []) as client:
        assert client.post("/ai/v1/requirements/analyze", json={"prompt": "find coding channels"}
                           ).status_code == 401


def test_analyze_returns_requirement_and_derived_schema(settings):
    with client_with(settings, [CHANNELS]) as client:
        response = client.post("/ai/v1/requirements/analyze",
                               json={"prompt": "find best youtube channels for coding"},
                               headers={"X-API-Key": KEY})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "valid"
    assert body["requirement"]["entityType"] == "youtube_channel"
    assert body["requirement"]["fields"][0]["key"] == "channel_name"
    assert body["extractionSchema"]["properties"]["records"]["items"]["properties"]["channel_url"]
    assert body["searchQueries"] == ["best coding youtube channels", "python tutorials channels"]


def test_analyze_rejects_a_prompt_too_vague_to_act_on(settings):
    with client_with(settings, [{"prompt": "data"}]) as client:
        assert client.post("/ai/v1/requirements/analyze", json={"prompt": "data"},
                           headers={"X-API-Key": KEY}).status_code == 422


def test_from_prompt_stops_and_asks_instead_of_collecting(settings):
    vague = {
        "requirement": {
            "objective": "Collect the usual company data",
            "entityType": "company",
            "fields": [{"key": "name", "label": "Name", "type": "STRING"}],
            "requiredFields": ["name"],
            "optionalFields": [],
            "missingInformation": ["which companies"],
        },
        "search_queries": [],
        "clarification_questions": ["Which companies?"],
    }
    with client_with(settings, [vague]) as client:
        response = client.post("/ai/v1/research/from-prompt",
                               json={"prompt": "collect the usual company data"},
                               headers={"X-API-Key": KEY})

    body = response.json()
    assert response.status_code == 200
    assert body["status"] == "NEEDS_CLARIFICATION"
    assert body["research"] is None, "collection must not start on an unresolved contract"
    assert body["clarificationQuestions"] == ["Which companies?"]
    assert body["extractionSchema"], "the draft contract is still shown so the user can see the cost"


def test_from_prompt_runs_the_graph_when_the_contract_is_complete(settings):
    submission = {"records": [{"channel_name": "Coding Cat",
                               "channel_url": "https://youtube.test/c/cat",
                               "source_url": "https://youtube.test/c/cat"}]}
    satisfactory = {"is_satisfactory": True, "reason": ["a", "b", "c"],
                    "improvement_instructions": ""}
    # one action payload (submit) then extraction then critique
    payloads = [CHANNELS, {"action": "submit", "reason": "searched via seeds"},
                submission, satisfactory]
    web = FakeWeb(search_results=[[SearchHit(url="https://youtube.test/c/cat", title="Coding Cat")]],
                  pages={"https://youtube.test/c/cat": Page(url="https://youtube.test/c/cat",
                                                            markdown="python tutorials",
                                                            status_code=200)})
    with client_with(settings, payloads, web=web) as client:
        response = client.post("/ai/v1/research/from-prompt",
                               json={"prompt": "find best youtube channels for coding"},
                               headers={"X-API-Key": KEY})

    body = response.json()
    assert response.status_code == 200
    # The fixture's requirement asks for 20 channels and the scripted run collects one, so
    # `COMPLETED_WITH_WARNINGS` with a named shortfall is the correct answer. A run that fell
    # short and reported plain success is the failure mode this project was rebuilt to remove.
    assert body["status"] == "COMPLETED_WITH_WARNINGS", body.get("research")
    assert body["research"]["records"], "the pipeline must deliver records"
    assert any("expected at least 20 records" in warning
               for warning in body["research"]["validation"]["warnings"])
    assert web.search_calls == ["best coding youtube channels", "python tutorials channels"], \
        "the requirement's own search queries should seed collection"
    # The requirement's search queries are what ran, and the record cites a URL this run
    # actually retrieved — that is the whole evidence promise of the pipeline.
    strategy = body["research"]["metadata"]["searchStrategy"]
    assert strategy["queries"] == ["best coding youtube channels", "python tutorials channels"]
    assert body["research"]["sources"][0]["verifiedByTool"] is True
    assert body["research"]["validation"]["recordsWithoutEvidence"] == []
