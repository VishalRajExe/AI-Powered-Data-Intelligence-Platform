"""Phase 6 — planner → act → **verify** → critique → correct, inside the one existing graph.

`TheAgenticBrowser-main` runs three agents (planner, browser, critique) around a local Playwright
browser. The topology is not taken — it would be a second orchestrator, and this service has one
research graph. What is taken is the two things that graph was missing, both of which are about
distrusting a successful-looking answer:

* an action's effect is **verified** against the page state rather than accepted because the session
  replied (`core/click_using_selector.py:45-58`, the mutation observer around one action, and
  `core/orchestrator.py:503-534`, where a separate judge is told the executor "will say the action
  was successful, but you have to visually confirm");
* the reviewer is shown **what was read**, not a list of URLs
  (`core/orchestrator.py:99-132` prunes DOM payloads before critique — this adapts the idea and
  refuses its bug, because blanking the content is what leaves the judge scoring a submission
  against evidence it was told to forget).
"""
from __future__ import annotations

import pytest

from app.config import Settings
from app.curation import relevance
from app.curation.policy import SourcePolicy
from app.extraction.schema_validate import field_checklist
from app.firecrawl.client import FakeInteractiveWeb, Interaction, Page, SearchHit
from app.llm.client import RecordingLlm
from app.research import prompts
from app.research.graph import STATUS_COMPLETED, STATUS_COMPLETED_WITH_WARNINGS, ResearchGraph
from app.research.state import ResearchLimits, ResearchState
from app.research.tools import _interaction_guidance, run_interact, run_scrape, run_search

URL = "https://acme.test/listing/1"
PAGE = "Acme is hiring."

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
SATISFIED = {"is_satisfactory": True, "reason": ["fields present", "urls observed", "one role"],
             "improvement_instructions": ""}


def limits(**overrides) -> ResearchLimits:
    base = dict(max_loops=8, max_search_results=5, max_searches_per_run=4, max_scrapes_per_run=4,
                max_interactions_per_run=3, allowed_tools=["search", "scrape", "interact"])
    base.update(overrides)
    return ResearchLimits(**base)


def state_for(**overrides) -> ResearchState:
    return ResearchState(topic="remote roles", extraction_schema=SCHEMA, limits=limits(**overrides))


def web_with(session_output: str, *, session_id: str = "brw_1",
             extra_sessions: dict[str, str] | None = None) -> FakeInteractiveWeb:
    """A search, one readable page, and a browser session scripted to answer with `session_output`."""
    return FakeInteractiveWeb(
        search_results=[[SearchHit(url=URL, title="Acme listing", snippet="roles")]],
        pages={URL: Page(url=URL, title="Acme", markdown=PAGE, status_code=200)},
        interactions={URL: Interaction(url=URL, prompt="open the salary filter",
                                       output=session_output, session_id=session_id)},
    )


def policy_for(state):
    return SourcePolicy(allowed_domains=state.limits.allowed_domains,
                        blocked_domains=state.limits.blocked_domains, robots=None)


def target_for(state):
    return relevance.target_from(topic=state.topic, entity_type=state.limits.entity_type,
                                 extraction_schema=state.extraction_schema,
                                 preferred_domains=state.limits.preferred_domains)


async def read_and_act(state, web):
    await run_search(state, web, "acme roles", policy=policy_for(state), target=target_for(state))
    await run_scrape(state, web, URL, policy=policy_for(state))
    return await run_interact(state, web, URL, "open the salary filter", policy=policy_for(state))


def build(settings, payloads, *, web):
    llm = RecordingLlm(payloads)
    return ResearchGraph(llm=llm, web=web, settings=settings, skills=None), llm


# --------------------------------------------------------------- the effect is verified


@pytest.mark.asyncio
async def test_a_session_that_changed_the_page_says_changed_not_succeeded():
    web = web_with("Salary band shown: 18-24 LPA.")
    state = state_for()

    outcome = await read_and_act(state, web)

    assert outcome.ok is True
    assert "verification: the page state changed" in outcome.content
    assert state.interactions[0].verdict == "CHANGED"
    # The claim stays as strong as the evidence: a page that moved is not a page whose filter worked.
    assert "succeeded" not in outcome.content.lower()


@pytest.mark.asyncio
async def test_a_session_that_returned_the_page_as_it_already_was_is_not_reported_as_done():
    web = web_with(PAGE)
    state = state_for()

    outcome = await read_and_act(state, web)

    assert state.interactions[0].verdict == "UNCHANGED"
    assert "Do not report this action as done" in outcome.content
    # The instruction offers the honest alternatives, and none of them is inventing the value the
    # action was meant to reveal.
    assert "do not infer the value" in outcome.content


@pytest.mark.asyncio
async def test_text_that_only_reflowed_is_not_claimed_as_a_page_that_moved():
    """A provider that re-serializes the same page differently is not an interaction that worked."""
    web = web_with("  ACME   is\nHIRING. ")
    state = state_for()

    await read_and_act(state, web)

    assert state.interactions[0].verdict == "UNCHANGED"


@pytest.mark.asyncio
async def test_a_session_on_a_page_that_was_never_read_cannot_claim_any_effect():
    web = web_with("Salary band shown: 18-24 LPA.")
    state = state_for()
    # Reached by search alone. The evidence rule lets a searched URL be driven, but nothing was ever
    # read from it, so there is no prior state to compare the session against — and the run says
    # "unknown" instead of assuming the action did something.
    await run_search(state, web, "acme roles", policy=policy_for(state), target=target_for(state))

    outcome = await run_interact(state, web, URL, "open the salary filter",
                                 policy=policy_for(state))

    assert outcome.ok is True
    assert state.interactions[0].verdict == "UNKNOWN"
    assert "was not read before the session" in outcome.content


@pytest.mark.asyncio
async def test_a_second_session_is_measured_against_where_the_first_one_left_the_page():
    answered = "Salary band shown: 18-24 LPA."
    web = FakeInteractiveWeb(
        search_results=[[SearchHit(url=URL, title="Acme listing", snippet="roles")]],
        pages={URL: Page(url=URL, title="Acme", markdown=PAGE, status_code=200)},
    )
    state = state_for()
    await run_search(state, web, "acme roles", policy=policy_for(state), target=target_for(state))
    await run_scrape(state, web, URL, policy=policy_for(state))

    async def session(url: str, prompt: str) -> Interaction:
        return Interaction(url=url, prompt=prompt, output=answered, session_id="brw_2")

    web.interact = session  # type: ignore[method-assign]
    await run_interact(state, web, URL, "open the salary filter", policy=policy_for(state))
    again = await run_interact(state, web, URL, "sort by newest", policy=policy_for(state))

    assert state.interactions[0].verdict == "CHANGED"
    # Compared against the post-action page, not the original read. Repeating an action whose state
    # is already there is the no-op the upstream loop could not see — it re-ran a failed step
    # against the same plan forever (`orchestrator.py:606-615`).
    assert state.interactions[1].verdict == "UNCHANGED"
    assert "Do not report this action as done" in again.content


# ---------------------------------------------------------------- critique sees evidence


@pytest.mark.asyncio
async def test_the_reviewer_is_shown_what_was_read_not_only_where_it_came_from():
    web = web_with("Salary band shown: 18-24 LPA.")
    state = state_for()

    await read_and_act(state, web)
    prompt = prompts.critique_prompt(state, field_checklist(SCHEMA), RECORDS)

    assert "content read:" in prompt
    assert "Salary band shown" in prompt
    assert "browser session asked to “open the salary filter”" in prompt
    assert "verification: CHANGED" in prompt
    assert "field names appearing in that text:" in prompt


def test_a_value_whose_field_name_appears_in_no_source_is_visible_to_the_reviewer():
    state = state_for()
    state.observe(URL, title="Acme", source_type="scrape")
    state.remember_page(URL, "Acme writes about hiring in general.")

    prompt = prompts.critique_prompt(state, field_checklist(SCHEMA), RECORDS)

    absent = prompt.split("absent:")[1]
    for name in ("company", "salary", "source_url"):
        assert name in absent


def test_the_correction_offers_another_source_and_never_a_way_round_a_wall():
    """The remedy for an action that did not take effect is more evidence, not a bypass."""
    text = _interaction_guidance("UNCHANGED", "the session returned the same content")

    assert "read a source that already states the value" in text
    assert "do not infer the value" in text
    lowered = text.lower()
    for forbidden in ("login", "log in", "password", "captcha", "bypass", "paywall", "credentials"):
        assert forbidden not in lowered, forbidden


def test_a_search_only_source_is_labelled_as_never_having_been_read():
    state = state_for()
    state.observe(URL, title="Acme listing", snippet="roles", source_type="search")

    prompt = prompts.critique_prompt(state, field_checklist(SCHEMA), RECORDS)

    assert "search snippet only, the page itself was never read" in prompt


def test_the_reviewer_is_told_that_an_unverified_session_supports_nothing():
    prompt = prompts.load("critique.md")

    assert "UNCHANGED" in prompt and "UNKNOWN" in prompt
    assert "attributable to content quoted in one of the sources" in prompt


# ------------------------------------------------------------------- the run reports it


@pytest.mark.asyncio
async def test_a_verified_interaction_still_completes_cleanly(settings: Settings):
    payloads = [
        {"action": "search", "reason": "find it", "query": "acme roles"},
        {"action": "scrape", "reason": "read it", "url": URL},
        {"action": "interact", "reason": "salary is behind a filter", "url": URL,
         "prompt": "open the salary filter"},
        {"action": "submit", "reason": "have the salary"},
        RECORDS, SATISFIED,
    ]
    graph, _ = build(settings, payloads, web=web_with("Salary band shown: 18-24 LPA."))

    outcome = await graph.run(topic="remote roles", extraction_schema=SCHEMA, limits=limits())

    assert outcome.status == STATUS_COMPLETED
    assert outcome.metadata["interactionsUnverified"] == 0
    assert outcome.metadata["interactions"][0]["verdict"] == "CHANGED"
    assert outcome.metadata["interactions"][0]["sessionId"] == "brw_1"


@pytest.mark.asyncio
async def test_a_run_built_on_a_session_it_cannot_verify_is_not_reported_clean(settings: Settings):
    """The page never moved, the reviewer still said yes, and the run says so with the doubt on it.

    The critique is an LLM verdict and cannot be treated as proof, so an unverifiable action is
    carried into the status rather than resolved by whichever checker was more optimistic.
    """
    payloads = [
        {"action": "search", "reason": "find it", "query": "acme roles"},
        {"action": "scrape", "reason": "read it", "url": URL},
        {"action": "interact", "reason": "salary is behind a filter", "url": URL,
         "prompt": "open the salary filter"},
        {"action": "submit", "reason": "have the salary"},
        {"roles": [{"company": "Acme", "salary": "₹18-24 LPA", "source_url": URL}]},
        SATISFIED,
    ]
    graph, _ = build(settings, payloads, web=web_with(PAGE))

    outcome = await graph.run(topic="remote roles", extraction_schema=SCHEMA, limits=limits())

    assert outcome.status == STATUS_COMPLETED_WITH_WARNINGS
    assert any("did not visibly change the page" in warning
               for warning in outcome.validation["warnings"])
    assert outcome.metadata["interactionsUnverified"] == 1
    # The record is still returned. A run that hides what it could not verify is the failure class
    # this rebuild removed.
    assert outcome.records[0]["values"]["salary"] == "₹18-24 LPA"


@pytest.mark.asyncio
async def test_the_run_says_where_its_model_turns_went(settings: Settings):
    payloads = [
        {"action": "search", "reason": "find it", "query": "acme roles"},
        {"action": "scrape", "reason": "read it", "url": URL},
        {"action": "submit", "reason": "enough"},
        RECORDS, SATISFIED,
    ]
    graph, _ = build(settings, payloads, web=web_with("Salary band shown: 18-24 LPA."))

    outcome = await graph.run(topic="remote roles", extraction_schema=SCHEMA, limits=limits())

    assert outcome.metadata["turnsByNode"] == {"plan_action": 3, "submit_extraction": 1,
                                               "critique": 1}

