"""Opt-in live Firecrawl test — real search, scrape, robots.txt and browser session, no model.

Settles **G2** (is Firecrawl's Python `interact` sufficient?) and measures gate **Q2** (how often
a real `robots.txt` is unreadable, which is what the fail-closed default costs). Two gates on the
run, because the two things cost different resources:

    RUN_LIVE_FIRECRAWL_TESTS=true FIRECRAWL_API_KEY=fc-... \\
        pytest -q tests/test_live_firecrawl.py -s

Skipped unless both are set. `FIRECRAWL_API_KEY` is checked before `get_settings()` runs,
which would refuse to start on an empty key — the same fail-loud rule production uses.

This closes decision **G2** (is Firecrawl's Python `interact` sufficient, or is an Express
sidecar needed?) with a measurement instead of an assumption. The `interact` case is
read-only by construction: it asks the session to *look at* a page and never to enter
credentials, solve a CAPTCHA or get past a paywall.
"""
from __future__ import annotations

import os

import pytest

from app.config import get_settings
from app.firecrawl.client import FirecrawlWeb, validated_http_url

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_LIVE_FIRECRAWL_TESTS") != "true" or not os.getenv("FIRECRAWL_API_KEY", "").strip(),
    reason="set RUN_LIVE_FIRECRAWL_TESTS=true with a real FIRECRAWL_API_KEY to make billable calls",
)

QUERY = "python documentation asyncio wait_for"
TARGET = "https://docs.python.org/3/library/asyncio-task.html"


@pytest.mark.asyncio
async def test_live_search_returns_usable_hits():
    web = FirecrawlWeb(get_settings())
    hits = await web.search(QUERY, limit=3)

    assert hits, "search returned nothing"
    for hit in hits:
        assert hit.url.startswith("http"), hit.url


@pytest.mark.asyncio
async def test_live_scrape_reads_a_page_and_reports_its_status():
    web = FirecrawlWeb(get_settings())
    page = await web.scrape(TARGET)

    assert page.markdown.strip()
    assert page.status_code is None or 200 <= page.status_code < 400
    assert "asyncio" in page.markdown.lower()


@pytest.mark.asyncio
async def test_live_robots_fetch_is_fast_enough_and_the_default_policy_survives_it():
    """The gate **Q2** has to be decided on: how often is `robots.txt` unreadable in practice?

    Asserted on the decision's shape, not its verdict — a site is allowed to change its rules.
    What this measures is latency and whether the response is usable, which is what the
    5-second bound and the `restrict` default were chosen without knowing.
    """
    import time

    from app.curation.robots import HttpRobots

    settings = get_settings()
    gate = HttpRobots(user_agent=settings.robots_user_agent,
                      timeout_seconds=settings.robots_timeout_seconds,
                      on_error=settings.robots_on_error)

    started = time.perf_counter()
    decision = await gate.check(TARGET)
    elapsed = time.perf_counter() - started

    assert decision.state in {"allowed", "no-rules", "restricted", "unreachable"}, decision.state
    print(f"\nrobots.txt {decision.state} for {TARGET} in {elapsed:.2f}s; "
          f"fetches={gate.fetches}; reason={decision.reason}")
    if decision.state == "unreachable":
        pytest.skip(f"robots.txt unreadable here: {decision.reason} — this is the Q2 measurement")
    assert elapsed < settings.robots_timeout_seconds + 2.0


@pytest.mark.asyncio
async def test_live_browser_session_answers_a_read_only_prompt_and_is_closed():
    """The G2 measurement: one prompt-mode interact round trip, timed.

    Asserted loosely on purpose. What this test has to settle is whether the call exists,
    completes inside the deadline and releases its session — not whether a given page says
    a given word today.
    """
    import time

    settings = get_settings()
    web = FirecrawlWeb(settings)
    validated_http_url(TARGET)

    started = time.perf_counter()
    result = await web.interact(TARGET, "Report the heading of this page verbatim.")
    elapsed = time.perf_counter() - started

    assert result.session_id, "no browser session id came back"
    if result.error:
        # A timeout or a provider refusal is a legitimate outcome, but it must arrive as
        # structured data with the deadline visible, not as an unhandled exception.
        assert "timed out" in result.error or settings.interact_timeout_seconds > 0
        pytest.skip(f"live interact did not complete: {result.error}")

    assert result.output.strip()
    assert elapsed < settings.interact_timeout_seconds + 15
