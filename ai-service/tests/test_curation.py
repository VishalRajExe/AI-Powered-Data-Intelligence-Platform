"""Source curation: relevance, ranking, policy, robots and retry.

Each test group states which upstream behaviour it is answering, because the point of this
stage is not to add cleverness — it is to stop the run wasting a bounded scrape budget on
duplicates and irrelevant pages, and to refuse a source for a reason the caller can read.
"""
from __future__ import annotations

import asyncio

import pytest

from app.contracts import RetryPolicy
from app.curation import queries
from app.curation.policy import SourcePolicy, domain_allowed, extract_hostnames
from app.curation.ranking import rank_hits, root_domain
from app.curation.relevance import score_hit, target_from
from app.curation.retry import (
    PERMANENT,
    RATE_LIMIT,
    SERVER_ERROR,
    TIMEOUT,
    TRANSIENT_NETWORK,
    backoff_delay,
    classify,
    is_retryable,
    run_with_retry,
)
from app.curation.robots import HttpRobots, StaticRobots, parse_decision
from app.firecrawl.client import FirecrawlWeb, Page, SearchHit, WebError
from tests.conftest import build_settings

RELEVANT = SearchHit(url="https://acme.test/jobs/remote-react-developer",
                     title="Remote React developer roles at Acme",
                     snippet="Full-stack react developer job, remote, salary disclosed")
TANGENTIAL = SearchHit(url="https://blog.test/10-best-vr-games",
                       title="10 best VR games of 2026",
                       snippet="Our reviewers played every headset game this year")


def job_target(**overrides):
    base = dict(
        topic="find remote frontend developer jobs in India with salary",
        entity_type="job",
        extraction_schema={
            "type": "object",
            "properties": {
                "records": {"type": "array", "items": {"properties": {
                    "company": {"type": "string"},
                    "role": {"type": "string"},
                    "salary": {"type": "string"},
                }}},
            },
        },
    )
    base.update(overrides)
    return target_from(**base)


# ------------------------------------------------------------------ relevance


def test_a_page_about_the_requested_thing_outranks_a_page_that_shares_one_word():
    target = job_target()
    ranked = score_hit(RELEVANT.url, RELEVANT.title, RELEVANT.snippet, target)
    weak = score_hit(TANGENTIAL.url, TANGENTIAL.title, TANGENTIAL.snippet, target)
    assert ranked.value > weak.value
    assert "react" in ranked.matched or "developer" in ranked.matched


def test_an_empty_target_says_so_instead_of_inventing_an_ordering():
    """With no vocabulary there is no basis to prefer one result; 0.5 across the board keeps the
    tie-break on the URL rather than pretending to a score."""
    empty = target_from(topic="", entity_type=None, extraction_schema={})
    assert empty.is_empty
    assert score_hit("https://a.test/x", "", "", empty).value == 0.5
    assert score_hit("https://b.test/y", "", "", empty).value == 0.5


def test_the_target_is_derived_from_the_request_so_changing_it_changes_the_scores():
    for_salary = job_target()
    without = job_target(topic="find remote frontend developer jobs in India",
                         extraction_schema={"type": "object", "properties": {
                             "records": {"type": "array", "items": {"properties": {
                                 "company": {"type": "string"}}}}}})
    hit = SearchHit(url="https://acme.test/jobs/1", title="Developer role",
                    snippet="salary band disclosed on request")
    assert score_hit(hit.url, hit.title, hit.snippet, for_salary).matched != \
        score_hit(hit.url, hit.title, hit.snippet, without).matched


def test_word_boundaries_are_respected_so_ai_does_not_match_maintenance():
    target = job_target(topic="maintenance engineer", entity_type="engineer")
    scoring = score_hit("https://x.test/maintenance", "Maintenance", "maintenance planning", target)
    assert "ai" not in scoring.matched


def test_a_preferred_domain_helps_and_a_non_preferred_one_hurts_without_erasing_the_score():
    target = job_target(preferred_domains=["acme.test"])
    preferred = score_hit(RELEVANT.url, RELEVANT.title, RELEVANT.snippet, target)
    neutral = score_hit(RELEVANT.url, RELEVANT.title, RELEVANT.snippet, job_target())
    other = score_hit(TANGENTIAL.url, TANGENTIAL.title, TANGENTIAL.snippet, target)
    assert preferred.value > neutral.value
    assert other.value >= 0.0, "a penalty must not underflow into a negative score"


def test_a_url_path_counts_as_evidence_of_relevance():
    target = job_target()
    in_path = score_hit("https://other.test/remote-react-developer-jobs", "", "", target)
    nowhere = score_hit("https://other.test/p/4412", "", "", target)
    assert in_path.value > nowhere.value


# ------------------------------------------------------------------ ranking


def test_duplicates_are_collapsed_and_the_reason_is_kept():
    hits = [RELEVANT,
            SearchHit(url=RELEVANT.url + "?utm_source=mail", title="dup", snippet="dup"),
            TANGENTIAL]
    ranking = rank_hits(hits, job_target())
    assert [candidate.url for candidate in ranking.candidates] == [RELEVANT.url, TANGENTIAL.url]
    duplicate = [dropped for dropped in ranking.dropped if dropped.code == "duplicate-url"]
    assert len(duplicate) == 1 and "same page" in duplicate[0].reason


def test_a_page_already_read_this_run_is_not_offered_again():
    from app.curation.canonical import canonical_key

    ranking = rank_hits([RELEVANT], job_target(), already_observed={canonical_key(RELEVANT.url)})
    assert ranking.candidates == []
    assert ranking.dropped[0].code == "already-observed"


def test_the_domain_cap_spreads_candidates_instead_of_betting_the_run_on_one_site():
    hits = [SearchHit(url=f"https://acme.test/jobs/{i}", title="Acme developer role",
                      snippet="react developer salary") for i in range(4)]
    uncapped = rank_hits(hits, job_target(), top_n=4, max_per_domain=0)
    capped = rank_hits(hits, job_target(), top_n=4, max_per_domain=2)
    assert len(uncapped.candidates) == 4
    assert len(capped.candidates) == 2
    assert all(dropped.code == "domain-cap" for dropped in capped.dropped)


def test_a_relevance_floor_drops_and_says_what_it_dropped():
    ranking = rank_hits([RELEVANT, TANGENTIAL], job_target(), min_score=0.2)
    kept = [candidate.url for candidate in ranking.candidates]
    assert RELEVANT.url in kept
    assert TANGENTIAL.url not in kept
    assert ranking.dropped[0].code == "low-relevance"
    assert "below the floor" in ranking.dropped[0].reason


def test_with_no_floor_nothing_is_dropped_for_vocabulary():
    ranking = rank_hits([RELEVANT, TANGENTIAL], job_target(), min_score=0.0)
    assert len(ranking.candidates) == 2 and ranking.dropped == []


def test_ordering_is_deterministic_even_on_ties():
    same_score = [SearchHit(url="https://z.test/page", title="same", snippet="same"),
                  SearchHit(url="https://a.test/page", title="same", snippet="same")]
    target = job_target()
    first = [c.url for c in rank_hits(same_score, target).candidates]
    second = [c.url for c in rank_hits(list(reversed(same_score)), target).candidates]
    assert first == second == ["https://a.test/page", "https://z.test/page"]


def test_candidates_beyond_the_limit_are_reported_not_silently_cut():
    hits = [SearchHit(url=f"https://s{i}.test/dev", title="developer", snippet="react developer")
            for i in range(6)]
    ranking = rank_hits(hits, job_target(), top_n=3)
    assert len(ranking.candidates) == 3
    assert [dropped.code for dropped in ranking.dropped].count("over-candidate-limit") == 3


def test_root_domain_treats_the_last_two_labels_as_the_publisher():
    assert root_domain("https://jobs.blog.acme.co/x") == "acme.co"
    assert root_domain("not a url") == ""


# ------------------------------------------------------------------ policy


def test_an_empty_allow_list_means_no_restriction_not_a_block():
    assert domain_allowed("https://anything.test/x", [], []) is True


def test_extract_hostnames_keeps_hosts_and_returns_prose_as_notes():
    hosts, notes = extract_hostnames([
        "acme.test",
        "https://boards.example.com/jobs",
        "the company's own website",
        "Example.ORG, Wired",
    ])
    assert hosts == ["acme.test", "boards.example.com", "example.org"]
    assert "the company's own website" in notes
    assert "Wired" in notes, "a comma-separated preference notes the part that is not a host"


def test_a_host_that_is_not_a_host_never_becomes_a_domain_rule():
    hosts, notes = extract_hostnames(["google", "news sites", "...", "a.b"])
    assert hosts == []
    # One note per unusable *preference*, not per word — the notes are shown to a human.
    assert notes == ["google", "news sites", "...", "a.b"]


@pytest.mark.asyncio
async def test_a_blocked_domain_is_refused_before_the_fetcher_is_called():
    policy = SourcePolicy(blocked_domains=["acme.test"], robots=StaticRobots())
    decision = await policy.check_fetch("https://acme.test/jobs/1")
    assert decision.allowed is False
    assert decision.code == "domain-policy"
    assert "block list" in decision.reason


@pytest.mark.asyncio
async def test_an_allow_list_excludes_everything_else():
    policy = SourcePolicy(allowed_domains=["example.com"])
    assert (await policy.check_fetch("https://example.com/x")).allowed is True
    assert (await policy.check_fetch("https://other.com/x")).allowed is False


@pytest.mark.asyncio
async def test_with_no_robots_gate_the_run_says_it_was_skipped_rather_than_silently_allowed():
    decision = await SourcePolicy().check_fetch("https://acme.test/x")
    assert decision.allowed is True
    assert decision.code == "robots-skipped"


# ------------------------------------------------------------------ robots


def test_disallow_is_honoured_for_our_user_agent():
    text = "User-agent: finalagent-research\nDisallow: /private/\nAllow: /public/\n"
    assert parse_decision(text, "finalagent-research", "https://acme.test/private/page").allowed is False
    assert parse_decision(text, "finalagent-research", "https://acme.test/public/page").allowed is True


def test_a_generic_rule_applies_when_our_agent_is_not_named():
    text = "User-agent: *\nDisallow: /secret/\n"
    assert parse_decision(text, "finalagent-research", "https://acme.test/secret/x").allowed is False


def test_an_empty_robots_file_is_no_rules_not_a_block():
    assert parse_decision("", "finalagent-research", "https://acme.test/any").allowed is True


def _robots_with(fetches: list, result) -> HttpRobots:
    gate = HttpRobots(user_agent="finalagent-research", timeout_seconds=2.0, on_error="restrict")

    async def fake_fetch(origin):
        fetches.append(origin[1])
        if isinstance(result, Exception):
            raise result
        return result

    gate._fetch = fake_fetch  # type: ignore[method-assign]
    return gate


@pytest.mark.asyncio
async def test_robots_txt_is_fetched_once_per_origin_not_once_per_url():
    """Upstream issued a fresh GET per URL (`web_scraper.py:24` inside the per-URL call); a
    10-page batch from one host should not be 10 extra requests to that host."""
    fetches: list[str] = []
    gate = _robots_with(fetches, ("User-agent: *\nDisallow: /nope/\n", None))
    await gate.check("https://acme.test/a")
    await gate.check("https://acme.test/b")
    await gate.check("https://acme.test/nope/c")
    assert fetches == ["acme.test"]
    assert (await gate.check("https://acme.test/nope/c")).allowed is False


@pytest.mark.asyncio
async def test_a_disallowed_path_is_not_cached_as_though_the_whole_host_were_closed():
    fetches: list[str] = []
    gate = _robots_with(fetches, ("User-agent: *\nDisallow: /nope/\n", None))
    assert (await gate.check("https://acme.test/nope/c")).allowed is False
    assert (await gate.check("https://acme.test/ok")).allowed is True


@pytest.mark.asyncio
async def test_a_missing_robots_file_means_no_rules():
    fetches: list[str] = []
    gate = _robots_with(fetches, (None, None))
    decision = await gate.check("https://acme.test/x")
    assert decision.allowed is True and decision.state == "no-rules"


@pytest.mark.asyncio
async def test_an_unreadable_robots_file_refuses_the_source_and_says_why():
    gate = _robots_with([], (None, "HTTP 503"))
    decision = await gate.check("https://acme.test/x")
    assert decision.allowed is False
    assert decision.state == "unreachable"
    assert "refused rather than fetched blind" in decision.reason


@pytest.mark.asyncio
async def test_the_operator_can_choose_to_proceed_blind_but_not_to_do_it_quietly():
    gate = HttpRobots(user_agent="finalagent-research", timeout_seconds=2.0, on_error="allow")

    async def failing(origin):
        raise OSError("no route")

    gate._fetch = failing  # type: ignore[method-assign]
    decision = await gate.check("https://acme.test/x")
    assert decision.allowed is True
    assert "proceeding without a readable policy" in decision.reason


@pytest.mark.asyncio
async def test_a_non_http_url_cannot_be_gated():
    gate = HttpRobots(user_agent="x", timeout_seconds=1.0)
    decision = await gate.check("file:///etc/passwd")
    assert decision.allowed is False and decision.state == "invalid-url"


@pytest.mark.asyncio
async def test_disabling_the_gate_is_visible_in_the_decision():
    gate = HttpRobots(user_agent="finalagent-research", timeout_seconds=1.0, enabled=False)
    decision = await gate.check("https://acme.test/x")
    assert decision.allowed is True and decision.state == "disabled"


# ------------------------------------------------------------------ retry


class ProviderError(Exception):
    def __init__(self, status_code: int) -> None:
        super().__init__(f"HTTP {status_code}")
        self.status_code = status_code


def test_classification_uses_the_providers_own_status():
    assert classify(ProviderError(429)) == RATE_LIMIT
    assert classify(ProviderError(503)) == SERVER_ERROR
    assert classify(ProviderError(404)) == PERMANENT
    assert classify(asyncio.TimeoutError()) == TIMEOUT
    assert classify(OSError("no route")) == TRANSIENT_NETWORK


def test_an_error_that_already_kinds_its_own_failure_is_believed():
    assert classify(WebError("scrape refused for x", kind=PERMANENT)) == PERMANENT


def test_only_the_classes_the_policy_names_are_retried():
    policy = RetryPolicy(maxAttempts=3, retryableErrors=["TIMEOUT", "RATE_LIMIT"])
    assert is_retryable(ProviderError(429), policy) is True
    assert is_retryable(ProviderError(503), policy) is False


def test_backoff_grows_is_capped_and_jitters_inside_a_bounded_band():
    assert backoff_delay(0, base_seconds=1.0, cap_seconds=20.0, jitter=False) == 1.0
    assert backoff_delay(3, base_seconds=1.0, cap_seconds=20.0, jitter=False) == 8.0
    assert backoff_delay(9, base_seconds=1.0, cap_seconds=20.0, jitter=False) == 20.0
    # Jitter spreads the wait across [0.5x, 1.5x] so a shared outage does not retry in lockstep:
    # a plain exponential with no ceiling and no spread was the reference implementation's shape.
    values = [backoff_delay(2, base_seconds=1.0, cap_seconds=20.0,
                            rng=lambda: fraction) for fraction in (0.0, 0.5, 1.0)]
    assert values == [2.0, 4.0, 6.0]


@pytest.mark.asyncio
async def test_a_flaky_call_succeeds_and_the_extra_attempts_are_counted():
    slept: list[float] = []
    calls = {"n": 0}

    async def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise ProviderError(429)
        return "ok"

    async def sleeper(seconds):
        slept.append(seconds)

    result, attempts, error = await run_with_retry(
        "scrape", flaky, policy=RetryPolicy(maxAttempts=4),
        base_seconds=1.0, cap_seconds=20.0, sleeper=sleeper, jitter=False)
    assert result == "ok" and error is None and attempts == 3
    assert slept == [1.0, 2.0]


@pytest.mark.asyncio
async def test_a_permanent_failure_is_not_retried():
    calls = {"n": 0}

    async def bad():
        calls["n"] += 1
        raise ProviderError(404)

    _, attempts, error = await run_with_retry(
        "scrape", bad, policy=RetryPolicy(maxAttempts=5),
        base_seconds=0.01, cap_seconds=0.02, sleeper=lambda _s: asyncio.sleep(0))
    assert attempts == 1 and calls["n"] == 1
    assert classify(error) == PERMANENT


@pytest.mark.asyncio
async def test_retries_are_bounded_and_the_last_error_survives():
    async def always_down():
        raise ProviderError(500)

    result, attempts, error = await run_with_retry(
        "scrape", always_down, policy=RetryPolicy(maxAttempts=3),
        base_seconds=0.001, cap_seconds=0.01, sleeper=lambda _s: asyncio.sleep(0))
    assert result is None and attempts == 3 and isinstance(error, ProviderError)


@pytest.mark.asyncio
async def test_a_policy_that_says_none_means_exactly_one_try():
    calls = {"n": 0}

    async def always_down():
        calls["n"] += 1
        raise ProviderError(500)

    _, attempts, _ = await run_with_retry(
        "scrape", always_down, policy=RetryPolicy(maxAttempts=5, strategy="none"),
        base_seconds=0.001, cap_seconds=0.01, sleeper=lambda _s: asyncio.sleep(0))
    assert attempts == 1 and calls["n"] == 1


class FlakyApp:
    """A stub SDK that fails twice with a rate limit, then answers."""

    def __init__(self) -> None:
        self.scrapes = 0

    async def scrape(self, url, **kwargs):
        self.scrapes += 1
        if self.scrapes < 3:
            raise ProviderError(429)
        return {"markdown": "the page", "metadata": {"url": url, "statusCode": 200}}


@pytest.mark.asyncio
async def test_the_web_client_retries_reads_and_counts_the_attempts():
    app = FlakyApp()
    web = FirecrawlWeb(build_settings(retry_base_delay_seconds=0.001,
                                      retry_max_delay_seconds=0.01),
                       app=app, sleeper=lambda _s: asyncio.sleep(0))
    page = await web.scrape("https://acme.test/x")

    assert isinstance(page, Page) and page.markdown == "the page"
    assert app.scrapes == 3
    assert web.retry_attempts == 2


@pytest.mark.asyncio
async def test_the_web_client_does_not_retry_a_browser_session():
    """Each attempt would create a new billable session; the interact deadline and the run's
    interaction budget already bound it, so retry here would multiply cost, not recover."""

    class AlwaysFailsBrowserApp:
        def __init__(self) -> None:
            self.browsers = 0

        async def browser(self, **kwargs):
            self.browsers += 1
            return {"id": "brw_1"}

        async def interact(self, job_id, code=None, **kwargs):
            raise ProviderError(500)

        async def stop_interaction(self, job_id):
            return {"success": True}

    app = AlwaysFailsBrowserApp()
    web = FirecrawlWeb(build_settings(), app=app, sleeper=lambda _s: asyncio.sleep(0))

    with pytest.raises(WebError, match="interact failed"):
        await web.interact("https://acme.test/x", "open the filter")

    assert app.browsers == 1


# ------------------------------------------------------------------ search strategy


def test_near_identical_queries_are_one_search_not_two():
    strategy = queries.build_strategy(
        queries=["Remote  React Jobs", "remote react jobs", "python channels", "  "],
        max_queries=5)
    assert strategy.queries == ["remote react jobs", "python channels"]


def test_the_query_list_is_fitted_to_the_search_budget_and_the_overflow_is_counted():
    requested = [f"query number {i}" for i in range(8)]
    strategy = queries.build_strategy(queries=requested, max_queries=4)
    assert len(strategy.queries) == 4
    assert queries.dropped_count(requested=requested, strategy=strategy) == 4
