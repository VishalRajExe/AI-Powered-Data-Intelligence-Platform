"""Identity: when two records are the same thing, and what happens when they disagree.

Three stages decide this, and the tests here are the reason each is separated:

* **Deduplication** answers "the key is the same". `EXACT` and `NORMALIZED` are reported apart,
  because a URL that agrees only after canonicalization is a weaker claim than a string that
  agrees as it stands, and the pipeline that reported them alike would be overstating its own work.
* **Entity resolution** answers "this is the same real-world thing". It requires a shared stable
  identifier. Similar names alone send a pair to review, because merging two different companies is
  unrecoverable and failing to merge two copies is not.
* **Merging** is where a disagreement becomes a recorded conflict. Both values survive, and the
  rule that chose between them is named on the conflict.
"""
from __future__ import annotations

from app.quality.contracts import RecordOut, SourceRef
from app.quality.dedupe import canonical_rank, dedupe_key, deduplicate
from app.quality.entity_resolution import (
    MERGE,
    REVIEW_REQUIRED,
    choose_name_field,
    identifier_values,
    levenshtein_ratio,
    normalize_name,
    pick_canonical,
    resolve,
)
from app.quality.merge import Link, apply_links


def record(index: int, values: dict, *, urls: list[str] | None = None,
           verified: bool = True, stamp: str = "2026-01-01T00:00:00Z") -> RecordOut:
    sources = [SourceRef(url=url, verified_by_tool=verified, retrieved_at=stamp)
               for url in (urls or ["https://src.test/1"])]
    return RecordOut(index=index, values=values, raw_values=dict(values), sources=sources)


# --------------------------------------------------------------------- deduplication


def test_the_same_url_spelled_two_ways_is_a_normalized_match_and_says_so():
    first = record(0, {"website": "https://www.openai.com/?utm_source=x"})
    second = record(1, {"website": "https://openai.com/"})

    result = deduplicate([first, second], ["website"])

    assert result.linked == 1
    assert second.duplicate_of == 0
    assert second.match_type == "NORMALIZED"


def test_case_and_padding_differences_are_still_an_exact_identity_but_a_url_rewrite_is_not():
    first = record(0, {"handle": " @OpenAI "})
    second = record(1, {"handle": "@openai"})

    result = deduplicate([first, second], ["handle"])

    assert second.match_type == "EXACT"
    # The link records which kind of match made it, so a reader can tell "the same string" from
    # "the same page once the URL was canonicalized". They are not the same claim.
    assert result.links[0][2] == "EXACT"


def test_a_composite_key_needs_every_part_to_agree_and_says_how_strongly_they_agree():
    first = record(0, {"website": "https://www.acme.test/", "handle": "@acme"})
    second = record(1, {"website": "https://acme.test/", "handle": "@acme"})

    result = deduplicate([first, second], ["website", "handle"])

    # The two handles are identical strings but the two URLs only agree once canonicalized, so the
    # composite identity is a normalized match, never an exact one.
    assert second.match_type == "NORMALIZED"
    assert [link[2] for link in result.links] == ["NORMALIZED"]


def test_one_differing_key_field_is_enough_to_keep_two_records_apart():
    first = record(0, {"website": "https://acme.test/a", "handle": "@acme"})
    second = record(1, {"website": "https://acme.test/b", "handle": "@acme"})

    assert deduplicate([first, second], ["website", "handle"]).linked == 0
    assert second.duplicate_of is None


def test_the_record_with_more_evidence_becomes_canonical_not_the_one_seen_first():
    thin = record(0, {"website": "https://acme.test/", "founded": None},
                  urls=["https://a.test/1"], verified=False)
    rich = record(1, {"website": "https://acme.test/"}, urls=["https://b.test/2"], verified=True)

    deduplicate([thin, rich], ["website"])

    assert thin.duplicate_of == 1
    assert rich.duplicate_of is None


def test_a_record_missing_any_key_field_gets_no_identity_rather_than_a_partial_one():
    first = record(0, {"website": "https://acme.test/", "slug": "acme"})
    second = record(1, {"website": "https://acme.test/"})

    assert dedupe_key(second, ["website", "slug"], normalized=True) is None
    result = deduplicate([first, second], ["website", "slug"])
    assert result.linked == 0


def test_two_records_with_nothing_in_common_stay_two_records():
    first = record(0, {"website": "https://a.test/"})
    second = record(1, {"website": "https://b.test/"})

    assert deduplicate([first, second], ["website"]).linked == 0


def test_no_deduplication_keys_is_reported_as_nothing_compared_rather_than_no_duplicates():
    records = [record(0, {"name": "Acme"}), record(1, {"name": "Acme"})]

    result = deduplicate(records, [])

    assert result.linked == 0
    assert any("no deduplicationKeys" in note for note in result.notes)
    assert all(record_.duplicate_of is None for record_ in records)


def test_a_pathological_block_is_reported_for_both_comparisons_it_prevented():
    # Six records that genuinely share a key, which is what turns blocking into a quadratic scan.
    records = [record(index, {"website": f"https://x.test/{index}", "company_name": "Untitled"})
               for index in range(6)]

    result = deduplicate(records, ["company_name"], max_block_size=3)

    assert result.linked == 0
    # Two scopes, two comparisons refused, both named: a single entry here would hide half of what
    # did not run.
    assert len(result.oversized_blocks) == 2
    assert all("6 records" in block for block in result.oversized_blocks)
    assert result.metrics()["oversizedBlocks"] == 2


def test_duplicates_are_linked_and_never_removed_from_the_set():
    first = record(0, {"website": "https://acme.test/a"})
    second = record(1, {"website": "https://acme.test/a"})

    deduplicate([first, second], ["website"])

    assert second.duplicate_of == 0
    assert second.values == {"website": "https://acme.test/a"}


# --------------------------------------------------------------------- entity resolution


def test_the_name_field_is_chosen_by_an_ordered_rule_and_not_by_schema_accident():
    records = [record(0, {"company_name": "Acme", "contact_name": "Ada"}),
               record(1, {"company_name": "Globex", "contact_name": "Grace"})]

    assert choose_name_field(records, ["contact_name", "company_name"]) == "company_name"
    assert choose_name_field([record(0, {"title": "VP Eng"})], ["title"]) == "title"
    assert choose_name_field([record(0, {"sku": "A1"})], ["sku"]) is None


def test_legal_noise_is_stripped_whole_word_so_costco_does_not_become_stco():
    assert normalize_name("Acme Corp.") == "acme"
    assert normalize_name("Costco") == "costco"
    assert normalize_name("Ltd") == "ltd"


def test_similarity_is_a_real_distance_and_not_a_rounding_of_one():
    assert levenshtein_ratio("openai", "openai") == 1.0
    assert levenshtein_ratio("microsoft", "mmicrosoft") == 0.9
    assert levenshtein_ratio("acme", "") == 0.0
    # One edit in a short string is a large distance; the same edit in a long name is not.
    assert levenshtein_ratio("ibm", "ibn") < levenshtein_ratio("ibm corporation",
                                                              "ibn corporation")


def test_two_records_sharing_an_identifier_merge_and_the_weaker_copy_becomes_the_duplicate():
    first = record(0, {"company_name": "Acme Robotics", "website": "https://acme.test/"},
                   urls=["https://x.test/1"])
    second = record(1, {"company_name": "Acme Robotics Incorporated",
                        "website": "https://acme.test/"}, urls=["https://y.test/2",
                                                               "https://z.test/3"])

    result, matches = resolve([first, second], name_field="company_name")

    assert result.merged == 1
    canonical, candidate = matches[0]
    assert candidate.decision == MERGE
    assert candidate.identifier_match
    assert pick_canonical(canonical, candidate.other).index == 1


def test_similar_names_without_a_shared_identifier_go_to_review_and_are_not_merged():
    first = record(0, {"company_name": "Acme Robotics", "website": "https://acme-robotics.test/"})
    second = record(1, {"company_name": "Acme Robotics", "website": "https://acme-india.test/"})

    result, matches = resolve([first, second], name_field="company_name")

    assert result.merged == 0
    assert result.review_required == 1
    assert matches[0][0].review_required is True
    assert matches[0][0].duplicate_of is None
    assert any("no shared identifier" in reason for reason in matches[0][0].review_reasons)


def test_an_identifier_match_cannot_be_displaced_by_a_mere_name_match():
    # The defect this replaces: the legacy candidate loop compared only `confidence`, so a 0.97
    # name match with nothing in common could beat an exact shared URL.
    anchor = record(0, {"company_name": "Acme Robotics", "website": "https://acme.test/"})
    identifier_match = record(1, {"company_name": "Acme Robotics Limited",
                                  "website": "https://acme.test/"})
    name_only = record(2, {"company_name": "Acme Robotics", "website": "https://other.test/"})

    _, matches = resolve([anchor, identifier_match, name_only], name_field="company_name")

    chosen = next(candidate for record_, candidate in matches if record_.index == 0)
    assert chosen.identifier_match
    assert chosen.other.index == 1


def test_entity_resolution_does_not_recompare_a_record_deduplication_already_linked():
    first = record(0, {"company_name": "Acme", "website": "https://acme.test/"})
    second = record(1, {"company_name": "Acme", "website": "https://acme.test/"})
    deduplicate([first, second], ["website"])

    result, matches = resolve([first, second], name_field="company_name")

    assert result.comparisons == 0
    assert matches == []


def test_no_name_field_means_the_stage_reports_that_it_compared_nothing():
    records = [record(0, {"sku": "A1"}), record(1, {"sku": "A2"})]

    result, matches = resolve(records, name_field=None)

    assert result.comparisons == 0
    assert any("no field could be identified" in note for note in result.notes)


def test_identifiers_are_recognised_by_what_they_are_not_by_a_list_of_lucky_names():
    found = identifier_values(record(0, {"linkedin_url": "https://linkedin.com/in/ada",
                                         "contact_email": " Ada@Acme.COM ",
                                         "tax_id": "IN123456",
                                         "description": "a company that makes robots"}))

    assert any(key.startswith("email:") for key in found)
    assert any("linkedin" in key for key in found)
    assert any("tax" in key for key in found)
    assert not any("description" in key for key in found)


# --------------------------------------------------------------------- conflict handling


def test_a_disagreement_keeps_both_values_and_names_the_rule_that_chose():
    backed = record(0, {"company_name": "Acme", "headcount": 500},
                    urls=["https://a.test/1", "https://b.test/2"])
    thin = record(1, {"company_name": "Acme", "headcount": 120}, urls=["https://c.test/3"])

    result = apply_links([backed, thin], [Link(canonical_index=0, duplicate_index=1,
                                               match_type="ENTITY", reason="website")])

    assert backed.values["headcount"] == 500
    assert result.conflicts == 1
    conflict = backed.conflicts[0]
    assert (conflict.field_key, conflict.kept_value, conflict.rejected_value) == (
        "headcount", 500, 120)
    assert conflict.resolved_by == "evidence-count"
    assert conflict.rejected_sources == ["https://c.test/3"]
    assert conflict.kept_sources == ["https://a.test/1", "https://b.test/2"]


def test_equal_evidence_falls_to_recency_and_then_to_canonical_position():
    older = record(0, {"name": "A", "city": "Pune"}, urls=["https://a.test/1"],
                   stamp="2026-01-01T00:00:00Z")
    newer = record(1, {"name": "A", "city": "Mumbai"}, urls=["https://b.test/2"],
                   stamp="2026-06-01T00:00:00Z")
    apply_links([older, newer], [Link(0, 1, "ENTITY", "email")])
    assert older.values["city"] == "Mumbai"
    assert older.conflicts[0].resolved_by == "recency"

    tied = record(2, {"name": "A", "city": "Delhi"}, urls=["https://c.test/3"],
                  stamp="2026-01-01T00:00:00Z")
    base = record(3, {"name": "A", "city": "Pune"}, urls=["https://d.test/4"],
                  stamp="2026-01-01T00:00:00Z")
    apply_links([base, tied], [Link(3, 2, "ENTITY", "email")])
    assert base.values["city"] == "Pune"
    assert base.conflicts[0].resolved_by == "canonical-position"


def test_a_merge_fills_what_was_missing_without_calling_it_a_conflict():
    sparse = record(0, {"name": "Acme"}, urls=["https://a.test/1"])
    rich = record(1, {"name": "Acme", "founded": "2015-01-27", "city": "Pune"},
                  urls=["https://b.test/2", "https://c.test/3"])

    result = apply_links([sparse, rich], [Link(1, 0, "ENTITY", "website")])

    assert rich.values == {"name": "Acme", "founded": "2015-01-27", "city": "Pune"}
    assert result.fields_filled == 0
    assert result.conflicts == 0
    assert sparse.duplicate_of == 1


def test_a_canonical_fills_a_gap_from_a_duplicate_that_had_it():
    strong = record(0, {"name": "Acme"}, urls=["https://a.test/1", "https://b.test/2"])
    weak_but_complete = record(1, {"name": "Acme", "city": "Pune"}, urls=["https://c.test/3"])

    result = apply_links([strong, weak_but_complete], [Link(0, 1, "ENTITY", "website")])

    assert strong.values["city"] == "Pune"
    assert result.fields_filled == 1


def test_merging_unions_the_sources_so_the_canonical_row_can_still_be_checked():
    first = record(0, {"name": "Acme"}, urls=["https://a.test/1"])
    second = record(1, {"name": "Acme"}, urls=["https://a.test/1", "https://b.test/2"])

    apply_links([first, second], [Link(0, 1, "ENTITY", "website")])

    assert [source.url for source in first.sources] == ["https://a.test/1", "https://b.test/2"]


def test_a_link_chain_resolves_to_the_row_the_dataset_actually_keeps():
    # A -> B and B -> C. A's values must arrive in C; if they landed in B the dataset would not
    # contain them, because B is itself a duplicate.
    a = record(0, {"name": "Acme", "city": "Pune"}, urls=["https://a.test/1"])
    b = record(1, {"name": "Acme"}, urls=["https://b.test/2", "https://c.test/3"])
    c = record(2, {"name": "Acme"}, urls=["https://d.test/4", "https://e.test/5"])

    result = apply_links([a, b, c], [Link(1, 0, "NORMALIZED", "website"),
                                    Link(2, 1, "NORMALIZED", "website")])

    assert c.values["city"] == "Pune"
    assert a.duplicate_of == 2
    assert b.duplicate_of == 2
    assert result.chains_collapsed == 1


def test_a_self_link_is_ignored_rather_than_merging_a_record_into_itself():
    only = record(0, {"name": "Acme"})

    result = apply_links([only], [Link(0, 0, "EXACT", "website")])

    assert result.merged_records == 0
    assert only.duplicate_of is None
    assert only.values == {"name": "Acme"}


def test_canonical_rank_prefers_evidence_then_completeness_then_the_earlier_index():
    with_evidence = record(0, {"name": "A"}, urls=["https://a.test/1", "https://b.test/2"])
    without = record(1, {"name": "A", "extra": "x"}, urls=["https://c.test/3"], verified=False)

    assert canonical_rank(with_evidence) > canonical_rank(without)
    assert pick_canonical(record(3, {"name": "A"}), record(4, {"name": "A"})).index == 3
