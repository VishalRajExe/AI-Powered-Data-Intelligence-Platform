"""Behaviour of the ported research graph.

Every test drives the graph with a scripted LLM and a fake web engine, so the gates and
bounds are exercised without a network, an API key, or a model that could decide
differently today than tomorrow.
"""
from __future__ import annotations

import pytest

from app.config import Settings
from app.firecrawl.client import FakeWeb, Page, SearchHit
from app.llm.client import RecordingLlm
from app.research.graph import (
    STATUS_COMPLETED,
    STATUS_COMPLETED_WITH_WARNINGS,
    STATUS_FAILED,
    ResearchGraph,
)
from app.research.state import ResearchLimits

SCHEMA = {
    "type": "object",
    "properties": {
        "channels": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "channel_name": {"type": "string"},
                    "channel_url": {"type": "string"},
                    "subscribers": {"type": "number"},
                },
                "required": ["channel_name", "channel_url"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["channels"],
    "additionalProperties": False,
}

GOOD_RECORD = {
    "channels": [
        {"channel_name": "Coding Cat", "channel_url": "https://youtube.test/c/codingcat", "subscribers": 91000},
    ]
}


def search_action(query: str = "best coding youtube channels") -> dict:
    return {"action": "search", "reason": "need candidates", "query": query}


scrape_action = {"action": "scrape", "reason": "read the channel page",
                 "url": "https://youtube.test/c/codingcat"}
submit_action = {"action": "submit", "reason": "enough gathered"}
satisfactory = {"is_satisfactory": True, "reason": ["fields present", "urls observed", "count matches"],
                "improvement_instructions": ""}


def make_web() -> FakeWeb:
    return FakeWeb(
        search_results=[[SearchHit(url="https://youtube.test/c/codingcat", title="Coding Cat",
                                   snippet="python tutorials")]],
        pages={"https://youtube.test/c/codingcat": Page(
            url="https://youtube.test/c/codingcat", title="Coding Cat",
            markdown="Coding Cat has 91,000 subscribers and posts python tutorials.", status_code=200)},
    )


def build(settings: Settings, payloads: list, *, limits: ResearchLimits | None = None,
          web: FakeWeb | None = None):
    llm = RecordingLlm(payloads)
    engine = web or make_web()
    resolved = limits or ResearchLimits(max_loops=6, max_search_results=5, max_searches_per_run=8,
                                        max_scrapes_per_run=12, model_id=settings.llm_model_id)
    return ResearchGraph(llm=llm, web=engine, settings=settings), llm, engine, resolved


@pytest.mark.asyncio
async def test_happy_path_produces_records_sources_and_metadata(settings):
    graph, llm, web, limits = build(
        settings, [search_action(), scrape_action, submit_action, GOOD_RECORD, satisfactory],
        limits=ResearchLimits(max_loops=6, max_search_results=5, max_searches_per_run=8,
                              max_scrapes_per_run=12, model_id="gemini-2.5-flash"))
    outcome = await graph.run(topic="find best youtube channels for coding",
                              extraction_schema=SCHEMA, limits=limits)

    assert outcome.status == STATUS_COMPLETED
    assert outcome.records[0]["values"]["channel_name"] == "Coding Cat"
    assert outcome.records[0]["sources"], "a record must carry the source it came from"
    assert outcome.records[0]["sources"][0]["verifiedByTool"] is True
    assert [source["url"] for source in outcome.sources] == ["https://youtube.test/c/codingcat"]
    assert outcome.metadata["loopsUsed"] == 3
    assert web.search_calls == ["best coding youtube channels"]
    assert web.scrape_calls == ["https://youtube.test/c/codingcat"]


@pytest.mark.asyncio
async def test_submit_before_any_evidence_is_refused_not_fabricated(settings):
    """Gate 2, ported from `agent.ts:37-40`: no answer before data."""
    graph, llm, web, limits = build(settings, [submit_action, search_action(), submit_action,
                                               GOOD_RECORD, satisfactory])
    outcome = await graph.run(topic="find best youtube channels for coding",
                              extraction_schema=SCHEMA, limits=limits)

    assert outcome.status == STATUS_COMPLETED
    assert web.search_calls, "the run only became eligible to submit after searching"
    # The premature submission never reached the extraction model.
    assert not any("Emit only the JSON object" in call["system"] for call in llm.calls[:2])


@pytest.mark.asyncio
async def test_schema_repair_loop_recovers(settings):
    bad = {"channels": [{"channel_name": "Coding Cat"}]}  # website missing
    graph, llm, web, limits = build(
        settings,
        [search_action(), submit_action, bad, submit_action, GOOD_RECORD, satisfactory],
        limits=ResearchLimits(max_loops=10, max_search_results=5, max_searches_per_run=8,
                              max_scrapes_per_run=12))
    outcome = await graph.run(topic="find best youtube channels for coding",
                              extraction_schema=SCHEMA, limits=limits)

    assert outcome.status == STATUS_COMPLETED
    assert outcome.validation["repairsUsed"] == 1
    assert outcome.validation["missingFields"] == []


@pytest.mark.asyncio
async def test_repair_budget_exhaustion_fails_rather_than_returning_approximate_data(settings):
    bad = {"channels": [{"channel_name": "x"}]}
    payloads = [search_action()] + [submit_action, bad] * 5
    graph, llm, web, limits = build(
        settings, payloads,
        limits=ResearchLimits(max_loops=20, max_search_results=5, max_searches_per_run=8,
                              max_scrapes_per_run=12))
    outcome = await graph.run(topic="find best youtube channels for coding",
                              extraction_schema=SCHEMA, limits=limits)

    assert outcome.status == STATUS_FAILED
    assert outcome.records == []
    assert "channel_url" in str(outcome.validation["missingFields"])
    assert outcome.failure_reason.startswith("submitted data never satisfied")


@pytest.mark.asyncio
async def test_loop_bound_stops_a_run_that_only_keeps_searching(settings):
    """The template applied its cap only after critique; a search-only run escaped it."""
    payloads = [search_action(f"query {index}") for index in range(10)]
    graph, llm, web, limits = build(
        settings, payloads,
        limits=ResearchLimits(max_loops=3, max_search_results=5, max_searches_per_run=50,
                              max_scrapes_per_run=50))
    outcome = await graph.run(topic="find best youtube channels for coding",
                              extraction_schema=SCHEMA, limits=limits)

    assert outcome.status == STATUS_FAILED
    assert "bound of 3" in outcome.failure_reason
    assert outcome.metadata["loopsUsed"] == 3
    assert len(web.search_calls) == 3, "the bound must cut the loop, not just report it"


@pytest.mark.asyncio
async def test_blocked_action_reports_failure_without_inventing_records(settings):
    graph, llm, web, limits = build(
        settings, [{"action": "blocked", "reason": "no public list exists for this"}])
    outcome = await graph.run(topic="find channels that refuse to be catalogued",
                              extraction_schema=SCHEMA, limits=limits)

    assert outcome.status == STATUS_FAILED
    assert outcome.records == []
    assert "no public list exists" in outcome.failure_reason


@pytest.mark.asyncio
async def test_unsatisfactory_critique_sends_the_run_back_for_more_evidence(settings):
    weak = {"is_satisfactory": False, "reason": ["one", "two", "three"],
            "improvement_instructions": "subscriber count is unevidenced; read the about page"}
    graph, llm, web, limits = build(
        settings, [search_action(), submit_action, GOOD_RECORD, weak,
                   scrape_action, submit_action, GOOD_RECORD, satisfactory])
    outcome = await graph.run(topic="find best youtube channels for coding",
                              extraction_schema=SCHEMA, limits=limits)

    assert outcome.status == STATUS_COMPLETED
    assert web.scrape_calls, "the feedback produced another retrieval, not an immediate resubmit"


@pytest.mark.asyncio
async def test_rejection_without_instructions_is_treated_as_a_bad_verdict(settings):
    """Their schema left `improvement_instructions` optional, yielding 'Unsatisfactory
    response: undefined'. A rejection with nothing actionable cannot drive another turn."""
    hollow = {"is_satisfactory": False, "reason": ["a", "b", "c"], "improvement_instructions": ""}
    graph, llm, web, limits = build(settings, [search_action(), submit_action, GOOD_RECORD, hollow])
    outcome = await graph.run(topic="find best youtube channels for coding",
                              extraction_schema=SCHEMA, limits=limits)

    assert outcome.status == STATUS_COMPLETED_WITH_WARNINGS
    assert outcome.validation["critiqueSatisfactory"] is None
    assert any("critique" in warning for warning in outcome.validation["warnings"])


@pytest.mark.asyncio
async def test_cited_url_never_retrieved_is_flagged_as_unverified(settings):
    invented = {"channels": [{"channel_name": "Ghost", "channel_url": "https://never-fetched.test/x"}]}
    graph, llm, web, limits = build(settings, [search_action(), submit_action, invented, satisfactory])
    outcome = await graph.run(topic="find best youtube channels for coding",
                              extraction_schema=SCHEMA, limits=limits)

    assert outcome.validation["unverifiedUrls"] == ["https://never-fetched.test/x"]
    assert outcome.status == STATUS_COMPLETED_WITH_WARNINGS
    assert outcome.records[0]["sources"] == []


@pytest.mark.asyncio
async def test_expected_record_shortfall_is_a_warning_not_a_success(settings):
    graph, llm, web, limits = build(
        settings, [search_action(), submit_action, GOOD_RECORD, satisfactory],
        limits=ResearchLimits(max_loops=6, max_search_results=5, max_searches_per_run=8,
                              max_scrapes_per_run=12, expected_records=50))
    outcome = await graph.run(topic="find best youtube channels for coding",
                              extraction_schema=SCHEMA, limits=limits)

    assert outcome.status == STATUS_COMPLETED_WITH_WARNINGS
    assert any("expected at least 50 records" in warning for warning in outcome.validation["warnings"])


@pytest.mark.asyncio
async def test_scrape_of_a_non_success_status_yields_no_evidence(settings):
    web = FakeWeb(
        search_results=[[SearchHit(url="https://blocked.test/page", title="Blocked")]],
        pages={"https://blocked.test/page": Page(url="https://blocked.test/page", markdown="",
                                                 status_code=403)},
    )
    graph, llm, web, limits = build(
        settings,
        [{"action": "search", "reason": "r", "query": "q"},
         {"action": "scrape", "reason": "r", "url": "https://blocked.test/page"},
         submit_action, GOOD_RECORD, satisfactory],
        web=web)
    outcome = await graph.run(topic="find best youtube channels for coding",
                              extraction_schema=SCHEMA, limits=limits)

    assert outcome.metadata["toolErrors"] >= 1
    assert outcome.validation["warnings"], "a blocked page must surface, not silently pass"


@pytest.mark.asyncio
async def test_blocked_domain_leaves_no_evidence_and_fails_rather_than_submitting_anyway(settings):
    """A filtered-out search yields nothing, and gate 2 then refuses a submission built
    on no evidence — so the run ends in failure instead of inventing records."""
    web = FakeWeb(search_results=[[SearchHit(url="https://reddit.com/r/python", title="reddit")]])
    graph, llm, web, limits = build(
        settings,
        [search_action(), {"action": "blocked", "reason": "every result is outside the domain policy"}],
        web=web,
        limits=ResearchLimits(max_loops=6, max_search_results=5, max_searches_per_run=8,
                              max_scrapes_per_run=12, blocked_domains=["reddit.com"]))
    outcome = await graph.run(topic="find best youtube channels for coding",
                              extraction_schema=SCHEMA, limits=limits)

    assert outcome.status == STATUS_FAILED
    assert outcome.records == []
    assert outcome.sources == []
    assert outcome.metadata["toolErrors"] >= 1
    assert web.search_calls == ["best coding youtube channels"]


@pytest.mark.asyncio
async def test_the_extraction_schema_itself_is_what_the_model_is_shown(settings):
    """No field list is baked into the graph: the caller's schema drives prompting."""
    graph, llm, web, limits = build(settings, [search_action(), submit_action, GOOD_RECORD, satisfactory])
    await graph.run(topic="find best youtube channels for coding", extraction_schema=SCHEMA, limits=limits)

    submission = next(call for call in llm.calls if "Emit only the JSON object" in call["system"])
    assert submission["schema"] == SCHEMA
    assert "channel_name" in submission["prompt"]
    assert "founder" not in submission["prompt"], "no startup template may leak into a coding prompt"
