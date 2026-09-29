"""Validation: the checks that decide whether a record may be believed.

Advisory in production — Java re-enforces before anything is persisted — but the checks themselves
have to be right, because a wrong verdict here is what the reviewer reads first.

The test that matters most in this file is the one about an unimplemented rule: the pipeline must
say it did not run something, and must not let the absence of a check look like a pass.
"""
from __future__ import annotations

from app.contracts import ValidationRule
from app.quality.contracts import (
    VERIFICATION_CONFLICTED,
    VERIFICATION_SOURCE_CITED,
    VERIFICATION_UNSUPPORTED,
    VERIFICATION_UNVERIFIED,
    Conflict,
    FieldSpec,
    RecordOut,
    SourceRef,
)
from app.quality.normalize import build_field_map
from app.quality.validate import evidence_for, validate_record, verification_status

SPEC = [
    FieldSpec(key="company_name", label="Company", type="STRING"),
    FieldSpec(key="website", label="Website", type="URL"),
    FieldSpec(key="headcount", label="Headcount", type="NUMBER"),
    FieldSpec(key="contact_email", label="Email", type="EMAIL"),
    FieldSpec(key="founded", label="Founded", type="DATE"),
    FieldSpec(key="stage", label="Stage", type="STRING"),
]


def map_():
    return build_field_map(SPEC, {}, ["company_name"])


def record(values: dict, sources: list[SourceRef] | None = None, index: int = 0) -> RecordOut:
    return RecordOut(index=index, values=values, raw_values=dict(values),
                     sources=sources if sources is not None else
                     [SourceRef(url="https://src.test/1", verified_by_tool=True)])


def codes(outcome) -> set[str]:
    return {issue.rule_code for issue in outcome.issues}


def severity_of(outcome, rule_code: str) -> str:
    return next(issue.severity for issue in outcome.issues if issue.rule_code == rule_code)


def run(record_: RecordOut, rules=None, uniqueness=None):
    return validate_record(record_, map_(), required_fields=["company_name"],
                           rules=rules or [], uniqueness=uniqueness)


def test_a_clean_record_with_a_verified_source_is_valid():
    outcome = run(record({"company_name": "Acme", "headcount": 12}))

    assert outcome.is_valid
    assert outcome.issues == []


def test_a_blank_required_field_is_the_same_absence_as_a_missing_one():
    missing = run(record({"headcount": 1}))
    blank = run(record({"company_name": "   "}))

    assert not missing.is_valid and not blank.is_valid
    assert "REQUIRED" in codes(missing) and "REQUIRED" in codes(blank)


def test_a_number_holding_text_is_a_type_error_not_a_quiet_zero():
    outcome = run(record({"company_name": "Acme", "headcount": "twelve"}))

    assert not outcome.is_valid
    assert "TYPE" in codes(outcome)


def test_format_rules_reach_the_values_they_name():
    outcome = run(record({"company_name": "Acme", "website": "openai.com",
                          "contact_email": "press-at-openai", "founded": "last spring"}))

    assert {"FORMAT_URL", "FORMAT_EMAIL", "FORMAT_DATE"} <= codes(outcome)


def test_a_month_only_date_is_accepted_and_its_reduced_precision_is_reported():
    outcome = run(record({"company_name": "Acme", "founded": "2015-03"}))

    assert outcome.is_valid
    assert severity_of(outcome, "DATE_PRECISION") == "INFO"


def test_a_currency_amount_without_its_unit_is_a_warning_because_assuming_one_would_be_worse():
    outcome = validate_record(
        record({"price": {"amount": 1200, "currency": None}}),
        build_field_map([FieldSpec(key="price", label="Price", type="CURRENCY")], {}, []),
        required_fields=[], rules=[])

    assert outcome.is_valid
    assert severity_of(outcome, "CURRENCY_CODE_MISSING") == "WARNING"


def test_a_four_letter_currency_code_is_an_error_because_it_is_not_a_code():
    outcome = validate_record(
        record({"price": {"amount": 1200, "currency": "DOLL"}}),
        build_field_map([FieldSpec(key="price", label="Price", type="CURRENCY")], {}, []),
        required_fields=[], rules=[])

    assert not outcome.is_valid
    assert "CURRENCY_CODE" in codes(outcome)


def test_declared_min_and_max_rules_are_actually_executed():
    rule = ValidationRule(rule="min", field="headcount", params={"min": 50})

    assert not run(record({"company_name": "Acme", "headcount": 12}), rules=[rule]).is_valid
    assert run(record({"company_name": "Acme", "headcount": 120}), rules=[rule]).is_valid


def test_a_rule_this_service_cannot_execute_is_reported_and_not_treated_as_passing():
    rule = ValidationRule(rule="percentile", field="headcount", params={"p": 90})
    outcome = run(record({"company_name": "Acme", "headcount": 120}), rules=[rule])

    assert outcome.is_valid
    assert "RULE_NOT_EXECUTED" in codes(outcome)
    assert severity_of(outcome, "RULE_NOT_EXECUTED") == "WARNING"
    assert outcome.unexecuted_rules == ["percentile"]


def test_a_regex_rule_with_no_pattern_says_so_instead_of_passing_everything():
    rule = ValidationRule(rule="regex", field="company_name", params={})
    outcome = run(record({"company_name": "Acme"}), rules=[rule])

    assert "RULE_NOT_EXECUTED" in codes(outcome)


def test_a_regex_rule_that_does_not_match_fails_the_record():
    rule = ValidationRule(rule="regex", field="company_name", params={"pattern": r"^Acme"})

    assert not run(record({"company_name": "Globex"}), rules=[rule]).is_valid
    assert run(record({"company_name": "Acme Robotics"}), rules=[rule]).is_valid


def test_enum_and_length_rules_use_the_parameters_the_plan_declared():
    enum = ValidationRule(rule="enum", field="stage", params={"values": ["seed", "series-a"]})
    long_ = ValidationRule(rule="length", field="company_name", params={"max": 4})

    assert run(record({"company_name": "Acme", "stage": "seed"}), rules=[enum]).is_valid
    assert not run(record({"company_name": "Acme", "stage": "pre-seed"}), rules=[enum]).is_valid
    assert not run(record({"company_name": "Acme Robotics"}), rules=[long_]).is_valid


def test_a_uniqueness_rule_needs_the_batch_and_says_so_without_one():
    rule = ValidationRule(rule="unique", field="company_name", params={})
    first = record({"company_name": "Acme"}, index=0)
    second = record({"company_name": "acme "}, index=1)

    without_batch = run(first, rules=[rule])
    assert "RULE_NOT_EXECUTED" in codes(without_batch)

    seen: dict[str, set] = {}
    assert run(first, rules=[rule], uniqueness=seen).is_valid
    assert not run(second, rules=[rule], uniqueness=seen).is_valid


def test_a_value_outside_the_declared_places_is_a_warning_not_a_rejection():
    rule = ValidationRule(rule="country", field="company_name", params={"places": ["India"]})
    outcome = run(record({"company_name": "Acme"}), rules=[rule])

    assert outcome.is_valid
    assert "COUNTRY" in codes(outcome)


def test_a_field_nobody_declared_is_reported_rather_than_hidden_or_removed():
    outcome = run(record({"company_name": "Acme", "founder_dob": "1980-02-02"}))

    assert "EXTRA_FIELD" in codes(outcome)
    assert severity_of(outcome, "EXTRA_FIELD") == "WARNING"


def test_a_record_with_no_sources_at_all_cannot_be_believed():
    outcome = run(record({"company_name": "Acme"}, sources=[]))

    assert not outcome.is_valid
    assert "SOURCE_EVIDENCE" in codes(outcome)


def test_citations_the_model_invented_are_flagged_without_being_deleted():
    sources = [SourceRef(url="https://ghost.test/report", verified_by_tool=False)]
    record_ = record({"company_name": "Acme"}, sources=sources)

    outcome = run(record_)

    assert outcome.is_valid
    assert severity_of(outcome, "SOURCE_EVIDENCE_UNVERIFIED") == "WARNING"
    assert record_.sources[0].url == "https://ghost.test/report"
    assert verification_status(record_) == VERIFICATION_UNVERIFIED


def test_evidence_counts_are_counts_and_nothing_else():
    record_ = record({"company_name": "Acme", "website": "https://openai.com/"}, sources=[
        SourceRef(url="https://openai.com/", verified_by_tool=True),
        SourceRef(url="https://news.test/a", verified_by_tool=True),
        SourceRef(url="https://news.test/b", verified_by_tool=False),
    ])

    evidence = evidence_for(record_)

    assert (evidence.source_count, evidence.verified_source_count,
            evidence.unverified_source_count, evidence.distinct_domains) == (3, 2, 1, 2)
    # The website column *is* one of the observed sources, so that one field carries its own
    # citation. Nothing is inferred about the other fields.
    assert evidence.fields_with_evidence == 1


def test_verification_states_follow_what_was_observed_and_conflicts_win():
    assert verification_status(record({}, sources=[])) == VERIFICATION_UNSUPPORTED
    cited = record({}, sources=[SourceRef(url="https://a.test", verified_by_tool=True)])
    assert verification_status(cited) == VERIFICATION_SOURCE_CITED

    cited.conflicts.append(Conflict(field_key="company_name", kept_value="A", rejected_value="B",
                                    resolved_by="evidence-count"))
    assert verification_status(cited) == VERIFICATION_CONFLICTED
