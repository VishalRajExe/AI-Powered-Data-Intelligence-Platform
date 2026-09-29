"""Normalization: what a value may be rewritten to, and what must never be invented.

Each test here is about a rule that could silently change data. A normalization that is wrong is
worse than one that is absent, because the wrong value looks cleaned.
"""
from __future__ import annotations

from app.quality.contracts import FieldSpec, RecordIn, SourceRef
from app.quality.normalize import build_field_map, fold_key, normalize_record


def field_map(*specs: FieldSpec, schema: dict | None = None, required: list[str] | None = None):
    return build_field_map(list(specs), schema or {}, required or [])


def one(values: dict, map_, **kwargs):
    record = RecordIn(values=values, sources=[SourceRef(url="https://s.test/1", verified_by_tool=True)])
    return normalize_record(record, map_, **kwargs)


def test_alias_map_is_built_from_the_request_not_from_a_table_in_this_module():
    map_ = field_map(FieldSpec(key="channel_url", label="Channel URL", type="URL"),
                     FieldSpec(key="subscriber_count", label="Subscribers", type="NUMBER"))
    record = one({"Channel URL": "https://youtube.test/c/x", "Subscribers": "1.2M"}, map_)

    assert record.values == {"channel_url": "https://youtube.test/c/x",
                             "subscriber_count": 1200000}


def test_a_schema_format_upgrades_a_weak_string_declaration_but_never_downgrades_a_strong_one():
    map_ = build_field_map(
        [FieldSpec(key="funding", label="Funding", type="CURRENCY"),
         FieldSpec(key="headcount", label="Headcount", type="STRING")],
        {"type": "object", "properties": {
            "funding": {"type": "string"},
            "headcount": {"type": "string", "format": "uri"}}},
        [])

    assert map_.types["funding"] == "CURRENCY"
    assert map_.types["headcount"] == "URL"


def test_currency_keeps_its_unit_and_a_suffix_is_expanded():
    map_ = field_map(FieldSpec(key="funding", label="Funding", type="CURRENCY"),
                     FieldSpec(key="valuation", label="Valuation", type="CURRENCY"))
    record = one({"funding": "$1.2B", "valuation": "€ 45,000"}, map_)

    assert record.values["funding"] == {"amount": 1_200_000_000, "currency": "USD"}
    assert record.values["valuation"] == {"amount": 45000, "currency": "EUR"}
    assert any("$" in note for note in record.notes), record.notes


def test_an_amount_with_no_currency_keeps_the_amount_and_leaves_the_unit_absent():
    map_ = field_map(FieldSpec(key="price", label="Price", type="CURRENCY"))

    assert one({"price": "1200"}, map_).values["price"] == {"amount": 1200, "currency": None}


def test_a_non_url_is_not_turned_into_one():
    # `canonical_key` will happily build "https://not a url/" out of a phrase. Normalization that
    # invents a scheme is the fabrication this pipeline exists to prevent.
    map_ = field_map(FieldSpec(key="website", label="Website", type="URL"))
    record = one({"website": "not a url"}, map_)

    assert record.values["website"] == "not a url"
    assert any("not an absolute URL" in note for note in record.notes)


def test_a_url_is_canonicalized_through_the_same_identity_the_curation_stage_uses():
    from app.curation.canonical import canonical_key

    map_ = field_map(FieldSpec(key="website", label="Website", type="URL"))
    record = one({"website": "HTTPS://WWW.OpenAI.com/?utm_source=x&b=2&a=1#tasks"}, map_)

    assert record.values["website"] == canonical_key("https://openai.com/?a=1&b=2")
    assert record.values["website"] == "https://openai.com/?a=1&b=2"


def test_ambiguous_day_and_month_order_is_left_alone_and_said_so():
    map_ = field_map(FieldSpec(key="founded", label="Founded", type="DATE"))
    record = one({"founded": "03/04/2024"}, map_)

    assert record.values["founded"] == "03/04/2024"
    assert any("ambiguous day/month" in note for note in record.notes)


def test_a_month_without_a_day_is_not_given_an_invented_first_of_the_month():
    map_ = field_map(FieldSpec(key="founded", label="Founded", type="DATE"))

    assert one({"founded": "March 2015"}, map_).values["founded"] == "2015-03"


def test_iso_dates_are_accepted_as_they_arrive():
    map_ = field_map(FieldSpec(key="founded", label="Founded", type="DATE"))

    assert one({"founded": "2015-01-27"}, map_).values["founded"] == "2015-01-27"


def test_a_placeholder_value_becomes_absent_rather_than_a_string():
    map_ = field_map(FieldSpec(key="website", label="Website", type="URL"),
                     FieldSpec(key="email", label="Email", type="EMAIL"))
    record = one({"website": "N/A", "email": "   "}, map_)

    assert record.values.get("website") is None
    assert record.values.get("email") is None
    assert any("treated as absent" in note for note in record.notes)


def test_a_value_with_no_declared_field_is_kept_and_reported_not_dropped():
    map_ = field_map(FieldSpec(key="company_name", label="Company", type="STRING"))
    record = one({"company_name": "Acme", "founder_dob": "1980-02-02"}, map_)

    assert record.values["founder_dob"] == "1980-02-02"
    assert record.unmapped_keys == ["founder_dob"]


def test_two_aliases_disagreeing_keep_the_first_and_say_so():
    map_ = field_map(FieldSpec(key="company_name", label="Company", type="STRING"))
    record = one({"company_name": "Acme Robotics", "Company": "Acme Robotics International"}, map_)

    assert record.values["company_name"] == "Acme Robotics"
    assert any("disagrees" in note for note in record.notes)


def test_a_duplicate_agreement_between_aliases_is_not_reported_as_a_disagreement():
    map_ = field_map(FieldSpec(key="company_name", label="Company", type="STRING"))
    record = one({"company_name": "Acme", "Company": "  acme  "}, map_)

    assert not any("disagrees" in note for note in record.notes)


def test_raw_values_survive_every_transformation():
    map_ = field_map(FieldSpec(key="funding", label="Funding", type="CURRENCY"),
                     FieldSpec(key="email", label="Email", type="EMAIL"))
    record = one({"funding": "$1.2B", "email": "  Press@OpenAI.COM "}, map_)

    assert record.raw_values == {"funding": "$1.2B", "email": "  Press@OpenAI.COM "}
    assert record.values["email"] == "press@openai.com"


def test_a_place_is_canonicalized_to_the_spelling_the_requirement_itself_used():
    map_ = field_map(FieldSpec(key="country", label="Country", type="STRING"))
    record = one({"country": "india"}, map_, places=["India", "United States"])

    assert record.values["country"] == "India"
    assert any("matched the requirement" in note for note in record.notes)


def test_a_place_outside_the_declared_set_is_left_exactly_as_written():
    map_ = field_map(FieldSpec(key="country", label="Country", type="STRING"))
    record = one({"country": "Bharat"}, map_, places=["India"])

    assert record.values["country"] == "Bharat"


def test_phone_extensions_are_preserved_instead_of_silently_dropped():
    map_ = field_map(FieldSpec(key="phone", label="Phone", type="PHONE"))
    record = one({"phone": "+1 (415) 555-0132 ext 44"}, map_)

    assert record.values["phone"] == "+14155550132 x44"
    assert any("extension 44 preserved" in note for note in record.notes)


def test_accounting_negatives_are_read_as_negatives_because_they_are_not_ambiguity():
    map_ = field_map(FieldSpec(key="adjustment", label="Adjustment", type="NUMBER"))
    record = one({"adjustment": "(1,250)"}, map_)

    assert record.values["adjustment"] == -1250
    assert any("parenthesised" in note for note in record.notes)


def test_booleans_arriving_as_words_are_read_without_touching_real_numbers():
    map_ = field_map(FieldSpec(key="remote", label="Remote", type="BOOLEAN"),
                     FieldSpec(key="seats", label="Seats", type="NUMBER"))
    record = one({"remote": "Yes", "seats": "1"}, map_)

    assert record.values["remote"] is True
    assert record.values["seats"] == 1


def test_fold_key_maps_every_spelling_of_the_same_column_onto_one_identity():
    assert fold_key("  Channel-URL ") == "channel_url"
    assert fold_key("ChannelURL") == "channelurl"
    assert fold_key("channel.url") == fold_key("channel url")
