"""`interact` as a graph action: gating, budget, and the evidence rule in front of it.

The web-layer lifecycle is covered in `test_firecrawl_interact.py`. What matters here is
that a tool which can *act* on a page is not reachable unless three separate things allow
it: the run's tool allowlist, the engine's capability, and a URL this run already
retrieved.
"""
from __future__ import annotations

import pytest

from app.config import Settings
from app.curation import relevance
from app.curation.policy import SourcePolicy
from app.firecrawl.client import (
    FakeInteractiveWeb,
    FakeWeb,
    Interaction,
    Page,
    SearchHit,
)
from app.llm.client import RecordingLlm
from app.research import prompts
from app.research.graph import STATUS_COMPLETED, ResearchGraph
from app.research.state import ResearchLimits, ResearchState
from app.research.tools import execute_many, run_interact, run_scrape, run_search

URL = "https://acme.test/listing/1"

SCHEMA = {
    "type": "object",
    "properties": {
        "roles": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "company": {"type": "string"},
                    "salary": {"type": "string"},
                    # What app/requirements/schema.py always adds: a record that cannot name
                    # the page it came from is not evidence, and the run should say so.
                    "source_url": {"type": "string",
                                   "description": "The page this record's values were read from."},
                },
                "required": ["company", "salary", "source_url"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["roles"],
    "additionalProperties": False,
}

RECORDS = {"roles": [{"company": "Acme", "salary": "₹18-24 LPA", "source_url": URL}]}
UNCITED_RECORDS = {"roles": [{"company": "Acme", "salary": "₹18-24 LPA",
                              "source_url": "https://elsewhere.test/never-fetched"}]}
SATISFIED = {"is_satisfactory": True, "reason": ["fields present", "urls observed", "one role"],
             "improvement_instructions": ""}


def limits(**overrides) -> ResearchLimits:
    base = dict(max_loops=8, max_search_results=5, max_searches_per_run=4, max_scrapes_per_run=4,
                max_interactions_per_run=2, allowed_tools=["search", "scrape", "interact"])
    base.update(overrides)
    return ResearchLimits(**base)


def state_for(**override_kwargs) -> ResearchState:
    return ResearchState(topic="remote roles", extraction_schema=SCHEMA, limits=limits(**override_kwargs))


def interactive_web(**overrides) -> FakeInteractiveWeb:
    base = dict(
        search_results=[[SearchHit(url=URL, title="Acme listing", snippet="roles")]],
        pages={URL: Page(url=URL, title="Acme", markdown="Acme is hiring.", status_code=200)},
        interactions={URL: Interaction(url=URL, prompt="open the salary filter",
                                       output="Salary band shown: 18-24 LPA.", session_id="brw_1")},
    )
    base.update(overrides)
    return FakeInteractiveWeb(**base)


# The graph builds a policy and a relevance target per run; these do the same for the
# tool-level tests, so each test states only what it is actually about.

def policy_for(state: ResearchState, robots=None) -> SourcePolicy:
    return SourcePolicy(allowed_domains=state.limits.allowed_domains,
                        blocked_domains=state.limits.blocked_domains,
                        robots=robots)


def target_for(state: ResearchState):
    return relevance.target_from(topic=state.topic, entity_type=state.limits.entity_type,
                                 extraction_schema=state.extraction_schema,
                                 preferred_domains=state.limits.preferred_domains)


async def search(state, web, query):
    return await run_search(state, web, query, policy=policy_for(state), target=target_for(state))


async def scrape(state, web, url):
    return await run_scrape(state, web, url, policy=policy_for(state))


async def interact(state, web, url, prompt):
    return await run_interact(state, web, url, prompt, policy=policy_for(state))


# ------------------------------------------------------------------ schema shape


def test_a_run_without_interact_is_never_offered_it():
    schema = prompts.action_schema(("search", "scrape"))
    assert schema["properties"]["action"]["enum"] == ["search", "scrape", "submit", "blocked"]
    assert "prompt" not in schema["properties"]


def test_enabling_interact_adds_the_action_and_its_prompt_field():
    schema = prompts.action_schema(("search", "scrape", "interact"))
    assert "interact" in schema["properties"]["action"]["enum"]
    assert schema["properties"]["prompt"]["type"] == "string"
    assert schema["additionalProperties"] is False


def test_the_request_can_narrow_the_tool_set_but_never_widen_it():
    assert prompts.allowed_data_tools(["search"], ["search", "scrape", "interact"]) == ["search"]
    assert prompts.allowed_data_tools(None, ["search", "scrape"]) == ["search", "scrape"]
    assert prompts.allowed_data_tools(["search", "interact"], ["search", "scrape"]) == ["search"]


def test_the_prompt_text_only_describes_enabled_tools():
    without = prompts.actions_help(("search", "scrape"))
    with_interact = prompts.actions_help(("search", "scrape", "interact"))
    assert "interact" not in without
    assert "login screen" not in without
    assert "live browser session" in with_interact


def test_the_prompt_forbids_using_a_browser_session_to_reach_past_access_controls():
    """A live session makes bypass *possible*, so the rule has to be said out loud."""
    prompt = prompts.research_prompt(state_for(), ["roles[].company"])
    assert "login screen" in prompt
    assert "CAPTCHA" in prompt


# ------------------------------------------------------------------ gating


@pytest.mark.asyncio
async def test_interact_is_refused_when_the_run_did_not_enable_it():
    state = state_for(allowed_tools=["search", "scrape"])
    await search(state, interactive_web(), "acme")

    outcome = await interact(state, interactive_web(), URL, "open the salary filter")

    assert outcome.ok is False
    assert "not enabled" in (outcome.error or "")
    assert state.budget.interactions_used == 0


@pytest.mark.asyncio
async def test_interact_is_refused_when_the_engine_cannot_do_it():
    """A web engine without browser sessions is a supported configuration, not a crash."""
    state = state_for()
    await search(state, FakeWeb(search_results=[[SearchHit(url=URL)]]), "acme")

    outcome = await interact(state, FakeWeb(), URL, "open it")

    assert outcome.ok is False
    assert "no browser session support" in (outcome.error or "")


@pytest.mark.asyncio
async def test_a_url_must_be_retrieved_before_the_agent_can_drive_it():
    state = state_for()

    outcome = await interact(state, interactive_web(), URL, "open the salary filter")

    assert outcome.ok is False
    assert "has not been retrieved" in (outcome.error or "")


@pytest.mark.asyncio
async def test_the_source_policy_applies_to_interact_as_it_does_to_scrape():
    state = state_for(blocked_domains=["acme.test"])
    await search(state, interactive_web(), "acme")

    outcome = await interact(state, interactive_web(), URL, "open it")

    assert outcome.ok is False
    assert "block list" in (outcome.error or "")
    assert state.refusals, "a refusal has to be recorded, not just returned"


@pytest.mark.asyncio
async def test_an_empty_prompt_is_refused_without_spending_budget():
    state = state_for()
    await search(state, interactive_web(), "acme")

    outcome = await interact(state, interactive_web(), URL, "  ")

    assert outcome.ok is False
    assert state.budget.interactions_used == 0


@pytest.mark.asyncio
async def test_the_interaction_budget_is_a_hard_stop():
    web = interactive_web()
    state = state_for(max_interactions_per_run=1)
    await search(state, web, "acme")
    await scrape(state, web, URL)

    first = await interact(state, web, URL, "one")
    second = await interact(state, web, URL, "two")

    assert first.ok is True
    assert second.ok is False
    assert "interaction budget exhausted" in (second.error or "")


# ------------------------------------------------------------------ outcomes


@pytest.mark.asyncio
async def test_a_successful_interact_becomes_evidence_and_upgrades_the_source():
    web = interactive_web()
    state = state_for()
    await search(state, web, "acme")
    await scrape(state, web, URL)

    outcome = await interact(state, web, URL, "open the salary filter")

    assert outcome.ok is True
    assert "18-24 LPA" in outcome.content
    assert state.sources[URL].source_type == "search+scrape+interact"
    assert state.budget.interactions_used == 1


@pytest.mark.asyncio
async def test_a_timeout_is_reported_as_a_refusal_with_its_fallback_advice():
    timed_out = Interaction(url=URL, prompt="paginate", timed_out=True,
                            error="interact timed out after 60.0s; fall back to scrape.")
    web = interactive_web(interactions={URL: timed_out})
    state = state_for()
    await search(state, web, "acme")
    await scrape(state, web, URL)

    outcome = await interact(state, web, URL, "paginate")

    assert outcome.ok is False
    assert "fall back to scrape" in (outcome.error or "")
    assert state.budget.interactions_used == 1, "a hung session still spends the budget"


@pytest.mark.asyncio
async def test_an_sdk_failure_becomes_a_tool_error_rather_than_a_failed_run():
    web = interactive_web(fail_interact_urls={URL})
    state = state_for()
    await search(state, web, "acme")
    await scrape(state, web, URL)

    outcome = await interact(state, web, URL, "open it")

    assert outcome.ok is False
    assert "refused" in (outcome.error or "")


@pytest.mark.asyncio
async def test_browser_sessions_are_not_available_in_parallel_batch_execution():
    """Upstream gives parallel workers search and scrape only (`worker/index.ts:61`)."""
    state = state_for()
    await search(state, interactive_web(), "acme")

    outcomes = await execute_many(state, interactive_web(), [("interact", URL), ("scrape", URL)],
                                  policy=policy_for(state), target=target_for(state))

    refused = [outcome for outcome in outcomes if outcome.name == "interact"]
    assert len(refused) == 1 and refused[0].ok is False
    assert "parallel batch" in (refused[0].error or "")
    assert state.budget.interactions_used == 0


# ------------------------------------------------------------------ through the graph


def build(settings: Settings, payloads: list, *, web):
    llm = RecordingLlm(payloads)
    return ResearchGraph(llm=llm, web=web, settings=settings, skills=None), llm


@pytest.mark.asyncio
async def test_the_graph_completes_a_run_that_used_a_browser_session(settings: Settings):
    payloads = [
        {"action": "search", "reason": "find the listing", "query": "acme roles"},
        {"action": "scrape", "reason": "read it", "url": URL},
        {"action": "interact", "reason": "salary is hidden behind a filter", "url": URL,
         "prompt": "open the salary filter"},
        {"action": "submit", "reason": "have the salary"},
        RECORDS,
        SATISFIED,
    ]
    web = interactive_web()
    graph, llm = build(settings, payloads, web=web)

    outcome = await graph.run(topic="remote roles", extraction_schema=SCHEMA, limits=limits())

    assert outcome.status == STATUS_COMPLETED
    assert outcome.records[0]["values"]["salary"] == "₹18-24 LPA"
    assert outcome.metadata["interactionsUsed"] == 1
    assert outcome.metadata["enabledTools"] == ["search", "scrape", "interact"]
    assert [hit["verifiedByTool"] for hit in outcome.sources] == [True]
    assert outcome.sources[0]["sourceType"] == "search+scrape+interact"


@pytest.mark.asyncio
async def test_the_graph_shows_the_model_only_the_tools_the_run_has(settings: Settings):
    resolved = limits(allowed_tools=["search", "scrape"], max_interactions_per_run=0, max_loops=1)
    graph, llm = build(settings, [{"action": "submit", "reason": "nothing else"}],
                       web=FakeWeb())

    await graph.run(topic="remote roles", extraction_schema=SCHEMA, limits=resolved)

    assert len(llm.calls) == 1
    first_call = llm.calls[0]
    assert first_call["schema"]["properties"]["action"]["enum"] == ["search", "scrape", "submit", "blocked"]
    assert "prompt" not in first_call["schema"]["properties"]
    assert "live browser session" not in first_call["prompt"]


@pytest.mark.asyncio
async def test_a_model_that_asks_for_a_disabled_tool_is_told_what_is_available(settings: Settings):
    payloads = [
        {"action": "interact", "reason": "try the browser", "url": URL, "prompt": "open it"},
        {"action": "blocked", "reason": "cannot read the salary without a browser"},
    ]
    resolved = limits(allowed_tools=["search", "scrape"], max_interactions_per_run=0)
    graph, llm = build(settings, payloads, web=FakeWeb())

    outcome = await graph.run(topic="remote roles", extraction_schema=SCHEMA, limits=resolved)

    assert "is not one of search, scrape, submit, blocked" in llm.calls[1]["prompt"]
    assert outcome.status == "FAILED"
    assert "cannot be satisfied from public sources" in outcome.failure_reason
