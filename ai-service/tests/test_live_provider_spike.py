"""Opt-in live provider test for the research graph.

Skipped unless `RUN_LIVE_PROVIDER_TESTS=true`, because it makes real Gemini and Firecrawl
calls against the developer's account. Everything else in this suite runs on doubles.

    RUN_LIVE_PROVIDER_TESTS=true pytest -q tests/test_live_provider_spike.py -s

This is the seam the provider phase uses to settle decision G2 (whether Firecrawl's Python
`interact` is sufficient) and to measure real token and credit cost.
"""
from __future__ import annotations

import os

import pytest

from app.config import get_settings
from app.curation.robots import build_robots_gate
from app.firecrawl.client import FirecrawlWeb
from app.llm.client import GeminiLlm
from app.research.graph import ResearchGraph
from app.research.state import ResearchLimits

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_LIVE_PROVIDER_TESTS") != "true",
    reason="set RUN_LIVE_PROVIDER_TESTS=true to make real, billable provider calls",
)

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
                    "focus": {"type": "string"},
                },
                "required": ["channel_name", "channel_url"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["channels"],
    "additionalProperties": False,
}


@pytest.mark.asyncio
async def test_live_research_run_produces_evidenced_records():
    settings = get_settings()
    # The same robots gate the HTTP path builds, so this spike measures what production does —
    # including the cost of a `robots.txt` fetch per origin, which no offline test can price.
    graph = ResearchGraph(llm=GeminiLlm(settings), web=FirecrawlWeb(settings), settings=settings,
                          robots=build_robots_gate(settings))

    outcome = await graph.run(
        topic="find five popular YouTube channels that teach Python",
        extraction_schema=SCHEMA,
        limits=ResearchLimits(max_loops=5, max_search_results=5, max_searches_per_run=3,
                              max_scrapes_per_run=4, expected_records=3,
                              allowed_domains=["youtube.com"], model_id=settings.llm_model_id),
    )

    print(f"\nstatus={outcome.status} records={len(outcome.records)} "
          f"sources={len(outcome.sources)} metadata={outcome.metadata}")
    print(f"validation={outcome.validation}")

    assert outcome.status in {"COMPLETED", "COMPLETED_WITH_WARNINGS"}, outcome.failure_reason
    assert outcome.records, "a live run must return at least one record"
    for record in outcome.records:
        assert record["sources"], "every record must cite a source it was built from"
        assert all(source["verifiedByTool"] for source in record["sources"])
    assert not outcome.validation["missingFields"]
