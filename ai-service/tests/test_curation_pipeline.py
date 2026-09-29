"""The curation stage inside the research graph, end to end.

These are the five cases the phase asked to be tested — irrelevant sources, a blocked source, a
duplicate source, retry, and a robots restriction — driven through `ResearchGraph` rather than
by calling the helpers directly, because the promise of the stage is about what a *run* reports:
not that the functions exist, but that a source which was never fetched cannot quietly become
evidence, and one that was refused says who refused it.
"""
from __future__ import annotations

import asyncio

import pytest

from app.curation.policy import SourcePolicy
from app.curation.relevance import target_from
from app.curation.robots import RobotsDecision, StaticRobots
from app.firecrawl.client import FirecrawlWeb, FakeWeb, Page, SearchHit
from app.llm.client import RecordingLlm
from app.research.graph import (
    STATUS_COMPLETED,
    STATUS_COMPLETED_WITH_WARNINGS,
    STATUS_FAILED,
    ResearchGraph,
)
from app.research.state import ResearchLimits
from tests.conftest import build_settings

USEFUL = "https://acme.test/jobs/remote-developer"
OFF_TOPIC = "https://blog.test/10-best-vr-games"
BLOCKED = "https://blocked.test/jobs/1"

SCHEMA = {
    "type": "object",
    "properties": {
        "records": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "company": {"type": "string"},
                    "role": {"type": "string"},
                    "salary": {"type": "string"},
                    "source_url": {"type": "string",
                                   "description": "The page this record's values were read from."},
                },
                "required": ["company", "role", "source_url"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["records"],
    "additionalProperties": False,
}


def limits(**overrides) -> ResearchLimits:
    base = dict(max_loops=8, max_search_results=5, max_searches_per_run=4, max_scrapes_per_run=4,
                allowed_tools=["search", "scrape"], entity_type="job",
                max_candidates_per_search=5, desired_sources=2)
    base.update(overrides)
    return ResearchLimits(**base)


TARGET = target_from(topic="find remote developer jobs with salary", entity_type="job",
                     extraction_schema=SCHEMA)


def build_payloads(*, action_after_search: dict, citation: str = USEFUL) -> list:
    """Scripted turns for a run whose seed query already searched before the model was asked.

    The graph runs `seed_queries` first, so the model's *first* turn is the one that sees the
    ranked results; the payload list starts there.
    """
    return [
        action_after_search,
        {"action": "submit", "reason": "have a role"},
        {"records": [{"company": "Acme", "role": "Remote Developer", "salary": "₹20 LPA",
                      "source_url": citation}]},
        {"is_satisfactory": True, "reason": ["fields present", "urls observed", "one record"],
         "improvement_instructions": ""},
    ]


def scrape_action(url: str = USEFUL) -> dict:
    return {"action": "scrape", "reason": "read the posting", "url": url}


def graph_for(settings, payloads, *, web, robots=None, resolved: ResearchLimits):
    llm = RecordingLlm(payloads)
    return ResearchGraph(llm=llm, web=web, settings=settings, skills=None,
                         robots=robots or StaticRobots()), llm, resolved


def web_with(*hits: SearchHit) -> FakeWeb:
    return FakeWeb(
        search_results=[list(hits)],
        pages={USEFUL: Page(url=USEFUL, title="Remote Developer", markdown="Acme remote developer, ₹20 LPA",
                           status_code=200)},
    )


# ------------------------------------------------------------------ irrelevant sources


@pytest.mark.asyncio
async def test_an_irrelevant_result_is_ranked_last_and_named_as_excluded(settings):
    """Upstream sorted by cosine and took the top M with **no threshold**
    (`get_relevant_urls.py:20-23`), so junk was scraped whenever the list was short."""
    web = web_with(SearchHit(url=OFF_TOPIC, title="10 best VR games", snippet="headset games ranked"),
                   SearchHit(url=USEFUL, title="Remote developer role at Acme",
                             snippet="react developer salary disclosed"))
    graph, llm, resolved = graph_for(settings, build_payloads(action_after_search=scrape_action()),
                                     web=web, resolved=limits(min_relevance_score=0.2))

    outcome = await graph.run(topic="find remote developer jobs with salary",
                              extraction_schema=SCHEMA, limits=resolved,
                              seed_queries=["remote developer jobs salary"])

    search_turn = llm.calls[0]["prompt"]
    assert USEFUL in search_turn
    assert "Excluded from this search" in search_turn and OFF_TOPIC in search_turn
    assert outcome.metadata["candidatesDropped"] == 1
    assert outcome.validation["droppedCandidates"][0]["code"] == "low-relevance"


@pytest.mark.asyncio
async def test_without_a_floor_the_weak_result_is_still_offered_but_outranked(settings):
    web = web_with(SearchHit(url=OFF_TOPIC, title="10 best VR games", snippet="headset games"),
                   SearchHit(url=USEFUL, title="Remote developer role at Acme",
                             snippet="react developer salary"))
    graph, llm, resolved = graph_for(settings, build_payloads(action_after_search=scrape_action()),
                                     web=web, resolved=limits())

    await graph.run(topic="find remote developer jobs with salary", extraction_schema=SCHEMA,
                    limits=resolved, seed_queries=["remote developer jobs salary"])

    turn = llm.calls[0]["prompt"]
    assert "Excluded from this search" not in turn
    assert turn.index(USEFUL) < turn.index(OFF_TOPIC), "ranking is the default behaviour"


# ------------------------------------------------------------------ blocked source


@pytest.mark.asyncio
async def test_a_source_outside_the_allow_list_is_refused_before_it_is_fetched(settings):
    """Everything this run may read is on the other side of a domain it is not allowed."""
    web = web_with(SearchHit(url=BLOCKED, title="Blocked listing", snippet="developer salary"))
    payloads = [
        scrape_action(BLOCKED),
        {"action": "blocked", "reason": "the only result is on a domain this run may not read"},
    ]
    graph, llm, resolved = graph_for(settings, payloads, web=web,
                                     resolved=limits(allowed_domains=["acme.test"]))

    outcome = await graph.run(topic="find remote developer jobs with salary",
                              extraction_schema=SCHEMA, limits=resolved,
                              seed_queries=["remote developer jobs salary"])

    assert web.scrape_calls == [], "a refused source must never reach the fetcher"
    assert outcome.status == STATUS_FAILED
    assert outcome.validation["refusedSources"], "the refusal is reported, not swallowed"
    assert outcome.validation["refusedSources"][0]["code"] == "domain-policy"
    # The planning turn now sees the run's evidence, and there is none: a refused search result
    # is not material, so the transcript says so instead of leaving the model to guess.
    assert "(nothing was retrieved)" in llm.calls[0]["prompt"]


@pytest.mark.asyncio
async def test_a_blocked_domain_wins_even_when_the_search_returned_it(settings):
    web = web_with(SearchHit(url=BLOCKED, title="Listing", snippet="developer jobs salary"))
    payloads = [
        scrape_action(BLOCKED),
        {"action": "blocked", "reason": "no readable sources"},
    ]
    graph, llm, resolved = graph_for(settings, payloads, web=web,
                                     resolved=limits(blocked_domains=["blocked.test"]))

    outcome = await graph.run(topic="find remote developer jobs with salary",
                              extraction_schema=SCHEMA, limits=resolved,
                              seed_queries=["remote developer jobs salary"])

    assert outcome.metadata["sourcesRefused"] >= 1
    assert web.scrape_calls == [], "a refused domain never reaches the fetcher, at any stage"
    assert any(refusal["url"] == BLOCKED for refusal in outcome.validation["refusedSources"])


# ------------------------------------------------------------------ duplicate source


@pytest.mark.asyncio
async def test_the_same_page_reached_twice_is_one_source_and_one_scrape(settings):
    """Upstream deduplicated on the raw URL string, so `?utm_source=` made one page two sources."""
    web = FakeWeb(
        search_results=[
            [SearchHit(url=USEFUL, title="Remote developer", snippet="react developer salary")],
            [SearchHit(url=f"{USEFUL}?utm_source=newsletter", title="Remote developer",
                       snippet="react developer salary")],
        ],
        pages={USEFUL: Page(url=USEFUL, title="Remote developer", markdown="₹20 LPA", status_code=200)},
    )
    payloads = [
        {"action": "search", "reason": "first pass", "query": "remote developer jobs"},
        {"action": "search", "reason": "second pass", "query": "remote developer jobs again"},
        {"action": "submit", "reason": "have a role"},
        {"records": [{"company": "Acme", "role": "Remote Developer", "salary": "₹20 LPA",
                      "source_url": USEFUL}]},
        {"is_satisfactory": True, "reason": ["a", "b", "c"], "improvement_instructions": ""},
    ]
    graph, llm, resolved = graph_for(settings, payloads, web=web, resolved=limits())

    outcome = await graph.run(topic="find remote developer jobs with salary",
                              extraction_schema=SCHEMA, limits=resolved)

    assert len(outcome.sources) == 1, "two spellings of one page must not become two sources"
    assert outcome.metadata["duplicateSourcesCollapsed"] == 1
    assert outcome.sources[0]["citedByRecords"] == 1


@pytest.mark.asyncio
async def test_a_page_already_read_is_not_offered_for_a_second_scrape(settings):
    web = web_with(SearchHit(url=USEFUL, title="Remote developer", snippet="developer salary"))
    payloads = [
        {"action": "search", "reason": "find", "query": "remote developer jobs"},
        {"action": "scrape", "reason": "read", "url": USEFUL},
        {"action": "scrape", "reason": "read it again", "url": f"{USEFUL}#reviews"},
        {"action": "submit", "reason": "have it"},
        {"records": [{"company": "Acme", "role": "Remote Developer", "salary": "₹20 LPA",
                      "source_url": USEFUL}]},
        {"is_satisfactory": True, "reason": ["a", "b", "c"], "improvement_instructions": ""},
    ]
    graph, llm, resolved = graph_for(settings, payloads, web=web, resolved=limits(max_loops=8))

    outcome = await graph.run(topic="find remote developer jobs with salary",
                              extraction_schema=SCHEMA, limits=resolved)

    assert web.scrape_calls == [USEFUL], "the fragment variant is the same page, already read"
    assert outcome.metadata["scrapesUsed"] == 1


# ------------------------------------------------------------------ retry


class RateLimitedApp:
    """A stub SDK that answers 429 twice, then serves the page."""

    def __init__(self) -> None:
        self.scrapes = 0
        self.searches = 0

    async def search(self, query, **kwargs):
        self.searches += 1
        return {"web": [{"url": USEFUL, "title": "Remote developer", "description": "react developer salary"}]}

    async def scrape(self, url, **kwargs):
        self.scrapes += 1
        if self.scrapes < 3:
            error = RuntimeError("too many requests")
            error.status_code = 429
            raise error
        return {"markdown": "Acme remote developer, ₹20 LPA",
                "metadata": {"url": url, "title": "Remote developer", "statusCode": 200}}


@pytest.mark.asyncio
async def test_a_run_completes_through_transient_provider_failures_and_reports_the_cost(settings):
    app = RateLimitedApp()
    web = FirecrawlWeb(build_settings(retry_max_attempts=3, retry_base_delay_seconds=0.001,
                                      retry_max_delay_seconds=0.01),
                       app=app, sleeper=lambda _s: asyncio.sleep(0))
    graph, llm, resolved = graph_for(settings, build_payloads(action_after_search=scrape_action()),
                                     web=web, resolved=limits())

    outcome = await graph.run(topic="find remote developer jobs with salary",
                              extraction_schema=SCHEMA, limits=resolved,
                              seed_queries=["remote developer jobs salary"])

    assert outcome.status == STATUS_COMPLETED
    assert app.scrapes == 3 and web.retry_attempts == 2
    assert outcome.metadata["retriesAttempted"] == 2
    assert outcome.records[0]["values"]["company"] == "Acme"


# ------------------------------------------------------------------ robots restriction


@pytest.mark.asyncio
async def test_a_robots_disallowed_page_is_refused_and_the_refusal_is_visible(settings):
    robots = StaticRobots(rules={USEFUL: RobotsDecision(False, "restricted",
                                                        reason="Disallow: /jobs/ for our user-agent")})
    web = web_with(SearchHit(url=USEFUL, title="Remote developer", snippet="developer salary"))
    graph, llm, resolved = graph_for(settings, build_payloads(action_after_search=scrape_action()),
                                     web=web, robots=robots, resolved=limits())

    outcome = await graph.run(topic="find remote developer jobs with salary",
                              extraction_schema=SCHEMA, limits=resolved,
                              seed_queries=["remote developer jobs salary"])

    assert web.scrape_calls == [], "robots said no, so nothing was fetched"
    refusal = outcome.validation["refusedSources"][0]
    assert refusal["code"] == "robots-restricted" and "Disallow" in refusal["reason"]
    assert any("refused before fetching" in warning for warning in outcome.validation["warnings"])


@pytest.mark.asyncio
async def test_a_refused_page_can_still_be_cited_but_reads_as_never_opened(settings):
    """`verifiedByTool` means a tool returned the URL; a search returned it, a scrape was refused.

    The record keeps its citation and the source row says `sourceType: "search"`, so a reviewer
    can see the weaker claim instead of being told both citations are equally solid.
    """
    robots = StaticRobots(rules={USEFUL: RobotsDecision(False, "restricted", reason="disallowed")})
    web = web_with(SearchHit(url=USEFUL, title="Remote developer", snippet="developer salary"))
    graph, llm, resolved = graph_for(settings, build_payloads(action_after_search=scrape_action()),
                                     web=web, robots=robots, resolved=limits())

    outcome = await graph.run(topic="find remote developer jobs with salary",
                              extraction_schema=SCHEMA, limits=resolved,
                              seed_queries=["remote developer jobs salary"])

    assert outcome.status == STATUS_COMPLETED_WITH_WARNINGS
    assert len(outcome.records) == 1, "the record is returned, not deleted"
    assert outcome.records[0]["sources"][0]["sourceType"] == "search"
    assert outcome.records[0]["sources"][0]["verifiedByTool"] is True
    assert outcome.validation["refusedSources"][0]["url"] == USEFUL


@pytest.mark.asyncio
async def test_a_record_citing_a_page_no_tool_ever_returned_is_flagged(settings):
    """The fabrication case: a plausible URL that never came from search or a scrape."""
    web = web_with(SearchHit(url=USEFUL, title="Remote developer", snippet="developer salary"))
    invented = "https://somewhere-else.test/press-release"
    payloads = [
        scrape_action(),
        {"action": "submit", "reason": "have a role"},
        {"records": [{"company": "Acme", "role": "Remote Developer", "salary": "₹20 LPA",
                      "source_url": invented}]},
        {"is_satisfactory": True, "reason": ["a", "b", "c"], "improvement_instructions": ""},
    ]
    graph, llm, resolved = graph_for(settings, payloads, web=web, resolved=limits())

    outcome = await graph.run(topic="find remote developer jobs with salary",
                              extraction_schema=SCHEMA, limits=resolved,
                              seed_queries=["remote developer jobs salary"])

    assert outcome.validation["unverifiedUrls"] == [invented]
    assert outcome.records[0]["sources"] == [], "an invented citation attaches to nothing"
    assert outcome.validation["recordsWithoutEvidence"] == [0]
    assert any("no source this run retrieved" in warning for warning in outcome.validation["warnings"])
    assert len(outcome.records) == 1, "flagged, never silently dropped"


@pytest.mark.asyncio
async def test_the_planning_turn_sees_what_has_already_been_retrieved(settings):
    """A defect in the Phase 2 port, found while writing this suite.

    The transcript was passed to the *submission* turn only, so the model chose its next
    action without ever seeing what search returned or what a page said — it could not tell
    "I have the salary" from "I have nothing". `data-enrichment-js` handed the whole message
    list to `callAgentModel` (`graph.ts:43-109`); this restores that, bounded by the truncation
    each tool result already carries.
    """
    web = web_with(SearchHit(url=USEFUL, title="Remote developer", snippet="developer salary"))
    graph, llm, resolved = graph_for(settings, build_payloads(action_after_search=scrape_action()),
                                     web=web, resolved=limits())

    await graph.run(topic="find remote developer jobs with salary", extraction_schema=SCHEMA,
                    limits=resolved, seed_queries=["remote developer jobs salary"])

    assert USEFUL in llm.calls[0]["prompt"], "the first plan turn must see the search results"
    assert "₹20 LPA" in llm.calls[1]["prompt"], "the second must see the scraped page"


@pytest.mark.asyncio
async def test_the_allow_list_and_the_robots_gate_compose_into_one_decision():
    """Domain and robots are checked by the same call, so a scrape cannot pass one and skip the
    other the way upstream's scraper and its robots helper were two separate concerns."""
    policy = SourcePolicy(allowed_domains=["acme.test"], robots=StaticRobots())
    assert (await policy.check_fetch(USEFUL)).allowed is True
    assert (await policy.check_fetch(BLOCKED)).allowed is False
