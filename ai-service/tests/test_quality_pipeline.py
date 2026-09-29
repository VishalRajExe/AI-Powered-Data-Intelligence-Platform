"""The pipeline end to end, over five different kinds of dataset.

The point of running five shapes rather than one is the defect this rebuild exists to remove: the
old project answered every prompt with the same startup schema, so a pipeline that only ever passed
a startup fixture could hide a fixture-shaped implementation. Each case below declares its own
fields and types, and asserts that the columns, the identity rules and the issues that came out are
that type's and not somebody else's.

The invariants that must hold for **every** type are asserted for every type: nothing is dropped,
nothing is invented, provenance survives, duplicates are linked, disagreements are kept, and a
stage that did not run says so.
"""
from __future__ import annotations

from typing import Any

import pytest

from app.contracts import ValidationRule
from app.quality import pipeline as pipeline_module
from app.quality.contracts import FieldSpec, QualityRequest, RecordIn, SourceRef
from app.quality.pipeline import process
from tests.conftest import build_settings

SETTING = build_settings()


def source(url: str, *, verified: bool = True, stamp: str = "2026-01-15T00:00:00Z",
           snippet: str = "") -> SourceRef:
    return SourceRef(url=url, verifiedByTool=verified, retrievedAt=stamp, snippet=snippet)


def request(*, entity: str, fields: list[FieldSpec], records: list[RecordIn],
            required: list[str], keys: list[str], rules: list[ValidationRule] | None = None,
            raw: int | None = None) -> QualityRequest:
    return QualityRequest(
        entityType=entity,
        objective=f"collect {entity}",
        fields=fields,
        requiredFields=required,
        deduplicationKeys=keys,
        validationRules=rules or [],
        extractionSchema={"type": "object", "properties": {
            "records": {"type": "array", "items": {
                "type": "object",
                "properties": {field.key: {"type": "string"} for field in fields},
                "additionalProperties": False}}},
            "additionalProperties": False},
        records=records,
        rawRecordCount=raw if raw is not None else len(records),
    )


def run(quality_request: QualityRequest):
    return process(quality_request, SETTING)


def stages(result) -> dict[str, Any]:
    return {stage.stage: stage for stage in result.stages}


# --------------------------------------------------------------------- five dataset types


def test_companies_funding_currency_and_a_shared_email_become_one_row_with_the_disagreement_kept():
    result = run(request(
        entity="company",
        fields=[FieldSpec(key="company_name", label="Company", type="STRING"),
                FieldSpec(key="website", label="Website", type="URL"),
                FieldSpec(key="contact_email", label="Email", type="EMAIL"),
                FieldSpec(key="funding", label="Funding", type="CURRENCY"),
                FieldSpec(key="headcount", label="Headcount", type="NUMBER")],
        required=["company_name"], keys=["website"],
        records=[
            RecordIn(values={"Company Name": "OpenAI", "website": "https://www.openai.com/?utm_source=x",
                              "contact_email": "press@openai.com", "funding": "$1.2B",
                              "headcount": "5,000"},
                     sources=[source("https://openai.com/", stamp="2026-01-01T00:00:00Z")]),
            RecordIn(values={"company_name": "Open AI Inc.", "website": "https://openai.com/",
                             "contact_email": "press@openai.com", "funding": "$1.5B",
                             "headcount": "4200"},
                     sources=[source("https://crunch.test/openai", stamp="2026-06-02T00:00:00Z"),
                              source("https://news.test/openai", stamp="2026-06-03T00:00:00Z")]),
        ]))

    assert result.status == "COMPLETED_WITH_WARNINGS"
    # One row, not two: the same page under two spellings, and a shared identifier besides.
    assert len(result.dataset.rows) == 1
    row = result.dataset.rows[0].values
    assert row["funding"] == {"amount": 1_500_000_000, "currency": "USD"}
    assert row["headcount"] == 4200
    canonical = next(record for record in result.records if record.duplicate_of is None)
    # Every field the two citations disagreed about is listed, including the name: "OpenAI" and
    # "Open AI Inc." are the same company, not the same string, and the discarded spelling stays
    # visible rather than disappearing with the losing row.
    assert [conflict.field_key for conflict in canonical.conflicts] == [
        "company_name", "funding", "headcount"]
    assert all(conflict.resolved_by == "evidence-count" for conflict in canonical.conflicts)
    assert canonical.conflicts[1].rejected_value == {"amount": 1_200_000_000, "currency": "USD"}
    assert canonical.conflicts[1].rejected_sources == ["https://openai.com/"]
    assert canonical.conflicts[0].rejected_value == "OpenAI"
    assert canonical.conflicts[0].rejected_sources == ["https://openai.com/"]
    # Provenance: the canonical row can still be checked against both sources it absorbed.
    assert {ref.url for ref in canonical.sources} == {
        "https://openai.com/", "https://crunch.test/openai", "https://news.test/openai"}


def test_job_postings_keep_their_salary_numbers_and_flag_the_posting_that_is_not_a_job():
    result = run(request(
        entity="job_posting",
        fields=[FieldSpec(key="job_title", label="Title", type="STRING"),
                FieldSpec(key="company", label="Company", type="STRING"),
                FieldSpec(key="salary", label="Salary", type="NUMBER"),
                FieldSpec(key="posted_date", label="Posted", type="DATE"),
                FieldSpec(key="apply_url", label="Apply", type="URL")],
        required=["job_title", "apply_url"], keys=["apply_url"],
        records=[
            RecordIn(values={"job_title": "Backend Engineer", "company": "Acme",
                             "salary": "₹18,00,000", "posted_date": "2024-11-05",
                             "apply_url": "https://acme.test/jobs/1"},
                     sources=[source("https://acme.test/jobs/1")]),
            RecordIn(values={"job_title": "Backend Engineer", "company": "Beta",
                             "salary": "90k", "posted_date": "2024-11-05",
                             "apply_url": "https://beta.test/careers/9"},
                     sources=[source("https://beta.test/careers/9")]),
            RecordIn(values={"company": "Gamma", "salary": "unlimited",
                             "apply_url": "not-a-link"},
                     sources=[source("https://gamma.test/jobs", verified=False)]),
        ]))

    rows = {row.record_index: row.values for row in result.dataset.rows}
    assert rows[0]["salary"] == 1800000
    assert rows[1]["salary"] == 90000
    # The third posting is missing its title and has an apply URL that is not a URL. It is still a
    # row, flagged: an unusable record is a finding, not something to delete.
    assert rows[2]["company"] == "Gamma"
    third = result.records[2]
    assert not third.is_valid
    assert {"REQUIRED", "FORMAT_URL"} <= {issue.rule_code for issue in third.issues}
    assert third.verification_status == "SOURCE_CITED_UNVERIFIED"
    assert result.quality.valid_count == 2
    assert result.quality.invalid_count == 1


def test_youtube_channel_counts_expand_and_two_names_for_one_channel_link_by_url():
    result = run(request(
        entity="youtube_channel",
        fields=[FieldSpec(key="channel_name", label="Channel", type="STRING"),
                FieldSpec(key="channel_url", label="Channel URL", type="URL"),
                FieldSpec(key="subscribers", label="Subscribers", type="NUMBER"),
                FieldSpec(key="country", label="Country", type="STRING")],
        required=["channel_name", "channel_url"], keys=["channel_url"],
        rules=[ValidationRule(rule="min", field="subscribers", params={"min": 1000})],
        records=[
            RecordIn(values={"channel_name": "Coding Cat",
                             "channel_url": "https://youtube.com/@codingcat?si=abc",
                             "subscribers": "312k", "country": "INDIA"},
                     sources=[source("https://youtube.com/@codingcat")]),
            RecordIn(values={"channel_name": "Traversy Media",
                             "channel_url": "https://youtube.com/traversymedia",
                             "subscribers": "1.2M", "country": "Bharat"},
                     sources=[source("https://youtube.com/traversymedia")]),
            RecordIn(values={"channel_name": "Tiny Channel",
                             "channel_url": "https://youtube.com/@tiny",
                             "subscribers": "812"},
                     sources=[source("https://youtube.com/@tiny")]),
        ]))

    values = {row.record_index: row.values for row in result.dataset.rows}
    assert values[0]["subscribers"] == 312000
    assert values[1]["subscribers"] == 1200000
    # The requirement named India, so that is the spelling the matching value takes. The other one
    # is left exactly as the source wrote it, because nothing here maps country names.
    assert values[0]["country"] == "INDIA"
    assert values[1]["country"] == "Bharat"
    # The declared minimum ran on the third channel and nothing else: the rule was executed, not
    # decorative.
    tiny = result.records[2]
    assert not tiny.is_valid
    assert any(issue.rule_code == "RANGE" for issue in tiny.issues)


def test_conference_speakers_merge_on_a_shared_email_and_refuse_to_merge_on_a_similar_name():
    result = run(request(
        entity="speaker",
        fields=[FieldSpec(key="speaker_name", label="Speaker", type="STRING"),
                FieldSpec(key="email", label="Email", type="EMAIL"),
                FieldSpec(key="affiliation", label="Affiliation", type="STRING"),
                FieldSpec(key="profile_url", label="Profile", type="URL")],
        required=["speaker_name"], keys=["email"],
        records=[
            RecordIn(values={"speaker_name": "Ada Lovelace", "email": "Ada@Analytical.test",
                             "affiliation": "Analytical Engines Ltd",
                             "profile_url": "https://conf.test/s/1"},
                     sources=[source("https://conf.test/s/1")]),
            # Same email (case folds), different name spelling and a stale affiliation.
            RecordIn(values={"speaker_name": "A. Lovelace", "email": "ada@analytical.test",
                             "affiliation": "Analytical Engines",
                             "profile_url": "https://conf.test/s/1?ref=a"},
                     sources=[source("https://conf.test/s/1", stamp="2026-03-01T00:00:00Z")]),
            # Same-sounding name, different person: no shared identifier at all.
            RecordIn(values={"speaker_name": "Ada Lovelace", "email": "ada@other.test",
                             "affiliation": "Other University",
                             "profile_url": "https://other.test/ada"},
                     sources=[source("https://other.test/ada")]),
            RecordIn(values={"speaker_name": "Grace Hopper", "email": "grace@navy.test",
                             "profile_url": "https://conf.test/s/2"},
                     sources=[source("https://conf.test/s/2")]),
        ]))

    canonical = [record for record in result.records if record.duplicate_of is None]
    # 4 records in, 3 rows out: the two Lovelace citations became one, and the third Lovelace stayed
    # separate because nothing identifies it as the same person.
    assert len(result.dataset.rows) == 3
    assert result.quality.duplicate_count == 1
    assert result.quality.review_required_count == 1
    reviewed = next(record for record in result.records if record.review_required)
    assert reviewed.values["email"] == "ada@analytical.test"
    assert any("no shared identifier" in reason for reason in reviewed.review_reasons)
    # The reason names which other record it might have been, so the review is actionable.
    assert any(reason.startswith("2:") for reason in reviewed.review_reasons)
    assert next(record for record in canonical
                if record.values.get("email") == "ada@analytical.test").values["affiliation"] \
        == "Analytical Engines"
    assert any(record.values.get("email") == "ada@other.test" for record in canonical)


def test_products_dedupe_by_sku_and_a_missing_price_is_never_defaulted_to_zero():
    result = run(request(
        entity="product",
        fields=[FieldSpec(key="product_name", label="Product", type="STRING"),
                FieldSpec(key="sku", label="SKU", type="STRING"),
                FieldSpec(key="price", label="Price", type="CURRENCY"),
                FieldSpec(key="in_stock", label="In stock", type="BOOLEAN"),
                FieldSpec(key="rating", label="Rating", type="NUMBER")],
        required=["sku"], keys=["sku"],
        rules=[ValidationRule(rule="regex", field="sku", params={"pattern": r"^[A-Z]{2}-\d{4}$"})],
        records=[
            RecordIn(values={"product_name": "Keyboard", "sku": "KB-1001", "price": "€79.90",
                             "in_stock": "yes", "rating": "4.6"},
                     sources=[source("https://shop.test/kb-1001")]),
            RecordIn(values={"product_name": "Keyboard (blue)", "sku": "kb-1001",
                             "price": "€ 85", "in_stock": True},
                     sources=[source("https://other.test/kb1001")]),
            RecordIn(values={"product_name": "Mouse", "sku": "MS-2002", "in_stock": "no",
                             "rating": "4.2"},
                     sources=[source("https://shop.test/ms-2002")]),
            RecordIn(values={"product_name": "Cable", "sku": "bad sku", "price": "12.00"},
                     sources=[source("https://shop.test/cable")]),
        ]))

    values = {row.record_index: row.values for row in result.dataset.rows}
    assert values[0]["price"] == {"amount": 79.9, "currency": "EUR"}
    assert values[0]["in_stock"] is True
    assert values[2]["in_stock"] is False
    # No price at all stays absent. Zero would be a price.
    assert "price" not in values[2] or values[2]["price"] is None
    # "kb-1001" and "KB-1001" are one product: the identity is case-insensitive on a SKU.
    assert result.quality.duplicate_count == 1
    bad = next(record for record in result.records if record.values.get("sku") == "bad sku")
    assert not bad.is_valid
    assert any(issue.rule_code == "REGEX" for issue in bad.issues)


def test_a_price_that_could_be_read_two_ways_is_not_read_at_all():
    # "€ 79,90" is European decimal to one reader and a thousands separator to another; guessing
    # either way is a 100× error on half the rows, so the amount is left absent and said so.
    result = run(request(
        entity="product",
        fields=[FieldSpec(key="sku", label="SKU", type="STRING"),
                FieldSpec(key="price", label="Price", type="CURRENCY")],
        required=["sku"], keys=["sku"],
        records=[RecordIn(values={"sku": "KB-1", "price": "€ 79,90"},
                          sources=[source("https://s.test/1")]),
                 RecordIn(values={"sku": "KB-2", "price": "$1,250.00"},
                          sources=[source("https://s.test/2")]),
                 RecordIn(values={"sku": "KB-3", "price": "₹18,00,000"},
                          sources=[source("https://s.test/3")])]))

    values = {row.record_index: row.values for row in result.dataset.rows}
    assert values[0]["price"] == {"amount": None, "currency": "EUR", "raw": "€ 79,90"}
    assert values[1]["price"] == {"amount": 1250.0, "currency": "USD"}
    # Indian lakh grouping has three-digit groups, so it is not ambiguous and is read.
    assert values[2]["price"] == {"amount": 1800000, "currency": "INR"}
    unparseable = next(record for record in result.records if record.index == 0)
    # The record is not invalid — the source did say something — but the gap has to be visible as
    # an unresolvable number rather than as a price that happens to be missing.
    assert unparseable.is_valid
    assert any(issue.rule_code == "CURRENCY_UNREADABLE" and issue.severity == "WARNING"
               for issue in unparseable.issues)
    assert any("could be a decimal point" in note for note in unparseable.normalization_notes)


# --------------------------------------------------------------------- invariants, per type

CASES = {
    "company": lambda: request(
        entity="company",
        fields=[FieldSpec(key="company_name", label="Company", type="STRING"),
                FieldSpec(key="website", label="Website", type="URL")],
        required=["company_name"], keys=["website"],
        records=[RecordIn(values={"company_name": "Acme", "website": "https://acme.test/"},
                          sources=[source("https://acme.test/")]),
                 RecordIn(values={"company_name": "Globex"}, sources=[])]),
    "job_posting": lambda: request(
        entity="job_posting",
        fields=[FieldSpec(key="job_title", label="Title", type="STRING"),
                FieldSpec(key="apply_url", label="Apply", type="URL")],
        required=["job_title"], keys=["apply_url"],
        records=[RecordIn(values={"job_title": "Engineer", "apply_url": "https://x.test/j/1"},
                          sources=[source("https://x.test/j/1")])]),
    "youtube_channel": lambda: request(
        entity="youtube_channel",
        fields=[FieldSpec(key="channel_name", label="Channel", type="STRING"),
                FieldSpec(key="subscribers", label="Subscribers", type="NUMBER")],
        required=["channel_name"], keys=["channel_name"],
        records=[RecordIn(values={"channel_name": "Cat", "subscribers": "10k"},
                          sources=[source("https://yt.test/cat")])]),
    "speaker": lambda: request(
        entity="speaker",
        fields=[FieldSpec(key="speaker_name", label="Speaker", type="STRING"),
                FieldSpec(key="email", label="Email", type="EMAIL")],
        required=["speaker_name"], keys=["email"],
        records=[RecordIn(values={"speaker_name": "Ada", "email": "ada@x.test"},
                          sources=[source("https://x.test/ada")])]),
    "product": lambda: request(
        entity="product",
        fields=[FieldSpec(key="product_name", label="Product", type="STRING"),
                FieldSpec(key="sku", label="SKU", type="STRING")],
        required=["sku"], keys=["sku"],
        records=[RecordIn(values={"product_name": "Keyboard", "sku": "KB-1"},
                          sources=[source("https://s.test/1")])]),
}


@pytest.mark.parametrize("entity", sorted(CASES))
def test_no_record_is_dropped_whatever_its_type(entity: str) -> None:
    quality_request = CASES[entity]()
    result = run(quality_request)

    assert [record.index for record in result.records] == list(range(len(quality_request.records)))
    assert result.quality.normalized_count == len(quality_request.records)
    assert result.quality.raw_count == result.quality.normalized_count
    # Every record still carries the sources it arrived with, in order.
    for given, record in zip(quality_request.records, result.records):
        assert [ref.url for ref in record.sources] == [ref.url for ref in given.sources]
    # Rows are the canonical records: linked duplicates stay in `records`, pointed at a survivor.
    assert {row.record_index for row in result.dataset.rows} == {
        record.index for record in result.records if record.duplicate_of is None}


@pytest.mark.parametrize("entity", sorted(CASES))
def test_the_columns_are_the_type_that_was_asked_for(entity: str) -> None:
    result = run(CASES[entity]())
    columns = {column.key for column in result.dataset.columns}

    expected = {field.key for field in CASES[entity]().fields}
    assert columns == expected


def test_five_dataset_types_yield_five_different_column_sets_not_one_reused_template():
    all_columns = {entity: tuple(column.key for column in run(CASES[entity]()).dataset.columns)
                   for entity in sorted(CASES)}

    assert len(set(all_columns.values())) == len(all_columns), all_columns


def test_no_record_is_ever_given_an_invented_confidence_or_score():
    result = run(request(
        entity="company",
        fields=[FieldSpec(key="company_name", label="Company", type="STRING")],
        required=["company_name"], keys=["company_name"],
        records=[RecordIn(values={"company_name": "Acme"}, sources=[])]))

    assert result.records[0].confidence is None
    assert result.records[0].verification_status == "UNSUPPORTED"


def test_an_empty_batch_is_reported_as_empty_rather_than_as_a_clean_dataset():
    result = run(request(entity="company",
                          fields=[FieldSpec(key="company_name", label="Company", type="STRING")],
                          required=[], keys=[], records=[]))

    assert result.records == []
    assert result.dataset.rows == []
    assert result.quality.quality_score is None
    assert result.quality.raw_count == 0
    assert any("no records" in warning for warning in result.warnings)
    assert stages(result)["score"].metrics["qualityScore"] is None


def test_a_raw_count_from_the_caller_makes_an_earlier_loss_visible():
    quality_request = request(
        entity="company",
        fields=[FieldSpec(key="company_name", label="Company", type="STRING")],
        required=["company_name"], keys=["company_name"],
        records=[RecordIn(values={"company_name": "Acme"}, sources=[source("https://a.test/1")])],
        raw=4)

    result = run(quality_request)

    assert result.quality.raw_count == 4
    assert result.quality.normalized_count == 1


def test_an_absent_raw_count_says_that_the_drop_cannot_be_seen():
    quality_request = request(
        entity="company",
        fields=[FieldSpec(key="company_name", label="Company", type="STRING")],
        required=["company_name"], keys=["company_name"],
        records=[RecordIn(values={"company_name": "Acme"}, sources=[source("https://a.test/1")])])
    quality_request.raw_record_count = None

    result = run(quality_request)

    assert any("any earlier loss is not visible" in note
               for note in stages(result)["score"].notes)


def test_a_stage_that_throws_is_reported_and_the_rest_of_the_pipeline_still_runs(monkeypatch):
    def explode(*args, **kwargs):
        raise RuntimeError("resolution exploded")

    monkeypatch.setattr(pipeline_module, "resolve", explode)
    quality_request = request(
        entity="company",
        fields=[FieldSpec(key="company_name", label="Company", type="STRING"),
                FieldSpec(key="website", label="Website", type="URL")],
        required=["company_name"], keys=["website"],
        records=[RecordIn(values={"company_name": "Acme", "website": "https://acme.test/"},
                          sources=[source("https://acme.test/")])])

    result = run(quality_request)

    resolve_stage = stages(result)["resolve"]
    assert resolve_stage.status == "FAILED"
    assert "resolution exploded" in resolve_stage.error
    # The stages that could run did, and the report is still there.
    assert stages(result)["normalize"].status == "COMPLETED"
    assert result.quality.normalized_count == 1
    assert len(result.dataset.rows) == 1
    assert result.status == "COMPLETED_WITH_WARNINGS"
    assert any("resolve stage failed" in warning for warning in result.warnings)


def test_a_normalization_failure_ends_the_run_without_a_substitute_record_set(monkeypatch):
    def explode(*args, **kwargs):
        raise RuntimeError("no field map")

    monkeypatch.setattr(pipeline_module, "normalize_record", explode)

    result = run(request(
        entity="company",
        fields=[FieldSpec(key="company_name", label="Company", type="STRING")],
        required=["company_name"], keys=["company_name"],
        records=[RecordIn(values={"company_name": "Acme"}, sources=[source("https://a.test/1")]),
                 RecordIn(values={"company_name": "Globex"}, sources=[])]))

    assert result.status == "FAILED"
    assert "no field map" in result.failure_reason
    assert result.records == []
    assert result.dataset.rows == []
    assert [stage.stage for stage in result.stages] == ["normalize"]


def test_a_record_the_validator_never_judged_is_not_left_claiming_to_be_valid(monkeypatch):
    calls = {"n": 0}
    original = pipeline_module.validate_record

    def fail_on_second(record, *args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("judgement failed")
        return original(record, *args, **kwargs)

    monkeypatch.setattr(pipeline_module, "validate_record", fail_on_second)
    result = run(request(
        entity="company",
        fields=[FieldSpec(key="company_name", label="Company", type="STRING")],
        required=["company_name"], keys=["company_name"],
        records=[RecordIn(values={"company_name": str(index)}, sources=[source(f"https://a.test/{index}")])
                 for index in range(4)]))

    validate_stage = stages(result)["validate"]
    assert validate_stage.status == "FAILED"
    # It died on the second of four, so one was judged and three were not.
    assert validate_stage.metrics["validatedBeforeFailure"] == 1
    assert validate_stage.metrics["neverValidated"] == 3
    # The first was judged; the rest are marked not-valid rather than keeping a default pass.
    assert [record.is_valid for record in result.records] == [True, False, False, False]


def test_a_date_that_could_be_read_two_ways_survives_as_text_and_is_flagged_not_rewritten():
    result = run(request(
        entity="job_posting",
        fields=[FieldSpec(key="job_title", label="Title", type="STRING"),
                FieldSpec(key="posted_date", label="Posted", type="DATE")],
        required=["job_title"], keys=["job_title"],
        records=[RecordIn(values={"job_title": "Engineer", "posted_date": "05/11/2024"},
                          sources=[source("https://x.test/j/1")])]))

    record = result.records[0]
    assert record.values["posted_date"] == "05/11/2024"
    assert any("ambiguous day/month" in note for note in record.normalization_notes)
    assert not record.is_valid
    assert any(issue.rule_code == "FORMAT_DATE" and issue.severity == "ERROR"
               for issue in record.issues)
    # The row is kept and flagged; a date nobody can read is a finding, not a reason to drop a
    # posting or to invent a November 5th.
    assert len(result.dataset.rows) == 1


def test_the_report_names_its_own_formula_because_a_number_without_a_provenance_is_a_claim():
    result = run(CASES["company"]())

    assert result.quality.score_basis.startswith("equal-weight mean of")
    assert set(result.quality.score_components) <= {"completeness", "validity", "uniqueness",
                                                    "consistency", "provenance"}
    assert "dimensions" in stages(result)["score"].metrics
    assert "recordConfidenceFormula" in stages(result)["score"].metrics
