"""Live requirement analysis: the three prompts from the brief, against real Gemini.

Skipped unless `RUN_LIVE_PROVIDER_TESTS=true` because it spends credits on the developer's
account. Requirement analysis needs no Firecrawl key and performs no collection.

    RUN_LIVE_PROVIDER_TESTS=true pytest -q tests/test_live_requirements.py -s

This is the test that distinguishes the rebuild from the thing it replaced: the old project
answered every prompt with the same startup schema.
"""
from __future__ import annotations

import os

import pytest

from app.config import get_settings
from app.llm.client import GeminiLlm
from app.requirements.schema import derive_extraction_schema
from app.requirements.service import RequirementAnalyzer

@pytest.fixture
def live_settings():
    """Real environment settings, including the developer's own GEMINI_API_KEY."""
    return get_settings()


pytestmark = pytest.mark.skipif(
    os.getenv("RUN_LIVE_PROVIDER_TESTS") != "true",
    reason="set RUN_LIVE_PROVIDER_TESTS=true to make real, billable Gemini calls",
)

PROMPTS = {
    "youtube": "find best youtube channels for coding",
    "startups": "find 100 AI startups in India with founder website funding",
    "jobs": "find remote frontend jobs in India with salary",
}


def _analyzer(settings):
    return RequirementAnalyzer(llm=GeminiLlm(settings), settings=settings)


@pytest.mark.asyncio
async def test_each_prompt_yields_its_own_extraction_schema(live_settings):
    schemas: dict[str, list[str]] = {}
    for label, prompt in PROMPTS.items():
        analysis = await _analyzer(live_settings).analyze(prompt)
        assert analysis.status == "valid", f"{label}: {analysis.clarification_questions}"
        item = analysis.extraction_schema["properties"]["records"]["items"]
        schemas[label] = sorted(key for key in item["properties"] if key != "source_url")
        print(f"\n{label}: entity={analysis.requirement.entity_type} "
              f"quantity={analysis.requirement.quantity} fields={schemas[label]}")

    assert len({tuple(value) for value in schemas.values()}) == 3, (
        f"schemas must differ per request, got {schemas}"
    )


@pytest.mark.asyncio
async def test_a_coding_prompt_does_not_inherit_the_startup_schema(live_settings):
    analysis = await _analyzer(live_settings).analyze(PROMPTS["youtube"])
    fields = {field.key for field in analysis.requirement.fields}

    assert not {"founder", "funding", "funding_usd", "company_name", "website"} & fields, (
        f"startup fields leaked into a channels request: {fields}"
    )
    assert {"channel_name", "channel_url", "subscribers"} & fields


@pytest.mark.asyncio
async def test_quantity_and_geography_come_from_the_words_not_a_template(live_settings):
    startups = await _analyzer(live_settings).analyze(PROMPTS["startups"])
    assert startups.requirement.quantity == 100
    assert "India" in startups.requirement.geography.places

    jobs = await _analyzer(live_settings).analyze(PROMPTS["jobs"])
    assert jobs.requirement.geography.places, "the jobs request also names India"
    assert derive_extraction_schema(jobs.requirement)["required"] == ["records"]
