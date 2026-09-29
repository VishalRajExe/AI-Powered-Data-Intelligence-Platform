"""SKILL.md playbooks: parsing, discovery, domain matching, and the traversal guard.

Ported behaviour from `web-agent-main/agent-core/src/skills/{parser,discovery,tools}.ts`.
The loader is tested against fixtures written here, not against upstream's six playbooks:
this deployment ships none of its own yet, and an empty skills directory is a supported
configuration rather than an error.
"""
from __future__ import annotations

import pytest

from app.firecrawl.client import FakeWeb, Page, SearchHit
from app.llm.client import RecordingLlm
from app.research.graph import ResearchGraph
from app.research.skills import (
    SkillAccessDenied,
    SkillLibrary,
    build_domain_index,
    discover_skills,
    domain_of,
    lookup_playbook,
    parse_frontmatter,
    slugify,
    validate_skill_content,
)

GOOD_SKILL = """---
name: Job boards
description: How to read job listings on acme.test without missing the salary field
category: research
domains:
  - acme.test
  - jobs.acme.test
---

## Navigation

Listings paginate with `?page=N`. The salary band only appears after the `Show more`
control is expanded, so a static read of the card is not the whole record.
"""

SITE_PLAYBOOK = """---
platform: Acme jobs
domains: [acme.test]
---

Use `/jobs/<slug>` for the full posting. The card URL and the posting URL differ.
"""

MISSING_DESCRIPTION = """---
name: Half written
---

Body exists but the frontmatter is incomplete.
"""


@pytest.fixture
def skills_root(tmp_path):
    root = tmp_path / "definitions"
    good = root / "job-boards"
    (good / "sites").mkdir(parents=True)
    (good / "SKILL.md").write_text(GOOD_SKILL, encoding="utf-8")
    (good / "sites" / "acme.md").write_text(SITE_PLAYBOOK, encoding="utf-8")
    (good / "pagination.md").write_text("# Pagination\n\nUse ?page=N\n", encoding="utf-8")

    bad = root / "half-written"
    bad.mkdir(parents=True)
    (bad / "SKILL.md").write_text(MISSING_DESCRIPTION, encoding="utf-8")

    empty_dir = root / "no-skill-file"
    empty_dir.mkdir(parents=True)

    (root / "outside.md").write_text("not inside a skill\n", encoding="utf-8")
    return root


# ------------------------------------------------------------------ frontmatter


def test_a_quoted_scalar_and_an_inline_list_are_both_read():
    data, body = parse_frontmatter('---\nname: "Quoted, Name"\ndomains: [a.test, b.test]\n---\n\nbody text')
    assert data["name"] == "Quoted, Name"
    assert data["domains"] == ["a.test", "b.test"]
    assert body == "body text"


def test_a_block_sequence_is_collected_into_a_list():
    data, _ = parse_frontmatter("---\nname: x\ndomains:\n  - a.test\n  - b.test\n---\nbody")
    assert data["domains"] == ["a.test", "b.test"]


def test_a_file_without_a_frontmatter_fence_is_entirely_body():
    data, body = parse_frontmatter("# Just a document\n\nno metadata here")
    assert data == {}
    assert body.startswith("# Just a document")


def test_an_unterminated_fence_is_treated_as_prose_not_metadata():
    """A document that merely starts with three dashes has no closing fence to key off."""
    data, body = parse_frontmatter("---\nname: never closed\n\nstill writing")
    assert data == {}
    assert "never closed" in body


def test_slugify_matches_upstream_behaviour():
    assert slugify("  Job Boards!! ") == "job-boards"
    assert slugify("...") == ""


def test_validation_requires_name_description_and_body():
    assert validate_skill_content(GOOD_SKILL).valid is True
    result = validate_skill_content(MISSING_DESCRIPTION)
    assert result.valid is False
    assert result.errors == ["Missing required field: description"]

    assert validate_skill_content("---\nname: Only A Name\ndescription: d\n---\n").errors == [
        "Empty body (no content after frontmatter)"
    ]


# ------------------------------------------------------------------ discovery


def test_a_valid_skill_loads_and_an_invalid_one_reports_why(skills_root):
    discovery = discover_skills(skills_root)

    assert [skill.name for skill in discovery.skills] == ["Job boards"]
    assert discovery.rejected == {"half-written": ["Missing required field: description"]}
    skill = discovery.skills[0]
    assert skill.slug == "job-boards"
    assert skill.category == "research"
    assert "pagination.md" in skill.resources
    assert [playbook.platform for playbook in skill.site_playbooks] == ["Acme jobs"]


def test_a_directory_without_a_skill_file_is_not_an_error(skills_root):
    discovery = discover_skills(skills_root)
    assert "no-skill-file" not in {skill.name for skill in discovery.skills}
    assert "no-skill-file" not in discovery.rejected


def test_a_missing_skills_directory_is_an_empty_library(tmp_path):
    discovery = discover_skills(tmp_path / "does-not-exist")
    assert discovery.skills == [] and discovery.rejected == {}


def test_a_site_playbook_without_domains_is_ignored(skills_root):
    stray = skills_root / "job-boards" / "sites" / "notes.md"
    stray.write_text("# Notes\n\nno frontmatter at all\n", encoding="utf-8")

    discovery = discover_skills(skills_root)
    assert [playbook.name for playbook in discovery.skills[0].site_playbooks] == ["acme"]


# ------------------------------------------------------------------ domain matching


def test_a_bare_domain_and_a_full_url_resolve_to_the_same_host():
    assert domain_of("https://www.acme.test/jobs/1") == "www.acme.test"
    assert domain_of("acme.test") == "acme.test"
    assert domain_of("https://user@acme.test/x") == "acme.test"


def test_lookup_tries_exact_then_www_stripped_then_a_suffix(skills_root):
    index = build_domain_index(discover_skills(skills_root).skills)

    assert lookup_playbook(index, "https://acme.test/jobs/1") is not None
    assert lookup_playbook(index, "https://www.acme.test/jobs/1") is not None
    assert lookup_playbook(index, "https://deep.sub.acme.test/x") is not None
    assert lookup_playbook(index, "https://other.test/x") is None
    assert lookup_playbook(index, "") is None


def test_playbooks_are_returned_once_each_and_in_url_order(skills_root):
    library = SkillLibrary(skills_root)

    found = library.playbook_bodies_for([
        "https://acme.test/jobs/1", "https://acme.test/jobs/2", "https://other.test/x",
    ])

    assert len(found) == 1
    label, body = found[0]
    assert label.startswith("Acme jobs")
    assert "Show more" not in body
    assert "full posting" in body


def test_an_empty_library_catalogs_to_nothing(tmp_path):
    library = SkillLibrary(tmp_path / "none")
    assert library.catalog == ""
    assert library.playbook_bodies_for(["https://acme.test"]) == []


def test_the_catalog_lists_name_and_description(skills_root):
    catalog = SkillLibrary(skills_root).catalog
    assert "Job boards:" in catalog
    assert "salary field" in catalog


# ------------------------------------------------------------------ traversal guard


def test_a_resource_inside_the_skill_directory_can_be_read(skills_root):
    library = SkillLibrary(skills_root)
    assert "?page=N" in library.read_resource("Job boards", "pagination.md")


@pytest.mark.parametrize(
    "relative",
    ["../outside.md", "sites/../../outside.md", "./../outside.md"],
)
def test_a_path_that_escapes_the_skill_directory_is_refused(skills_root, relative):
    library = SkillLibrary(skills_root)
    with pytest.raises(SkillAccessDenied, match="path traversal"):
        library.read_resource("Job boards", relative)


def test_a_redundant_path_that_stays_inside_the_skill_is_not_traversal(skills_root):
    """The guard measures where the path *lands*, not whether it contains `..`."""
    library = SkillLibrary(skills_root)
    assert "?page=N" in library.read_resource("Job boards", "sites/../pagination.md")


def test_an_absolute_path_outside_the_skill_is_refused(skills_root, tmp_path):
    library = SkillLibrary(skills_root)
    with pytest.raises(SkillAccessDenied):
        library.read_resource("Job boards", str(tmp_path))


def test_reading_a_file_that_is_not_there_names_what_is(skills_root):
    library = SkillLibrary(skills_root)
    with pytest.raises(FileNotFoundError, match="pagination.md"):
        library.read_resource("Job boards", "nope.md")


def test_an_unknown_skill_name_is_refused(skills_root):
    with pytest.raises(KeyError):
        SkillLibrary(skills_root).read_resource("No such skill", "pagination.md")


# ------------------------------------------------------------------ graph wiring


SCHEMA = {
    "type": "object",
    "properties": {
        "roles": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"company": {"type": "string"}, "salary": {"type": "string"}},
                "required": ["company", "salary"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["roles"],
    "additionalProperties": False,
}

URL = "https://acme.test/jobs/1"


@pytest.mark.asyncio
async def test_a_playbook_for_a_domain_the_run_reached_is_injected_into_the_plan_turn(
    settings, skills_root
):
    payloads = [
        {"action": "search", "reason": "find postings", "query": "acme roles"},
        {"action": "scrape", "reason": "read the posting", "url": URL},
        {"action": "submit", "reason": "have the salary"},
        {"roles": [{"company": "Acme", "salary": "18-24 LPA"}]},
        {"is_satisfactory": True, "reason": ["a", "b", "c"], "improvement_instructions": ""},
    ]
    llm = RecordingLlm(payloads)
    web = FakeWeb(
        search_results=[[SearchHit(url=URL, title="Acme")]],
        pages={URL: Page(url=URL, markdown="Acme hiring", status_code=200)},
    )
    graph = ResearchGraph(llm=llm, web=web, settings=settings, skills=SkillLibrary(skills_root))

    outcome = await graph.run(topic="acme roles", extraction_schema=SCHEMA)

    # No playbook on the first turn: the run has not touched acme.test yet.
    assert "Acme jobs" not in llm.calls[0]["prompt"]
    assert "full posting" in llm.calls[1]["prompt"]
    assert "Site playbooks" in llm.calls[1]["prompt"]
    assert outcome.metadata["playbooksUsed"] == ["Acme jobs (Job boards)"]
