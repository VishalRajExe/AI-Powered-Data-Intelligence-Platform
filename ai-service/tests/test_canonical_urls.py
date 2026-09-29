"""URL identity: the same page reached two ways is one source.

`web-research-agent-master` deduplicates on the exact URL string it was handed
(`get_relevant_urls.py:16-19`). This covers the variants a real search result list contains.
"""
from __future__ import annotations

from app.curation.canonical import canonical_key, same_page


def test_campaign_parameters_and_fragments_do_not_make_a_second_source():
    base = "https://acme.test/jobs/1"
    for variant in (
        f"{base}?utm_source=newsletter&utm_medium=email",
        f"{base}#salary",
        f"{base}?utm_source=x#frag",
        "https://www.acme.test/jobs/1",
        "HTTPS://ACME.test/jobs/1",
        "https://acme.test:443/jobs/1",
    ):
        assert canonical_key(variant) == base, variant


def test_scheme_is_preserved_because_http_and_https_can_be_different_pages():
    assert canonical_key("http://acme.test:80/jobs/1") == "http://acme.test/jobs/1"
    assert canonical_key("http://acme.test/jobs/1") != canonical_key("https://acme.test/jobs/1")


def test_a_meaningful_parameter_is_kept_and_order_does_not_matter():
    first = canonical_key("https://acme.test/jobs?page=2&sort=date")
    second = canonical_key("https://acme.test/jobs?sort=date&page=2")
    assert first == second
    assert "page=2" in first and "sort=date" in first


def test_a_parameter_that_changes_content_is_never_dropped_as_tracking():
    assert canonical_key("https://acme.test/jobs?id=7") != canonical_key("https://acme.test/jobs")
    assert canonical_key("https://acme.test/search?q=python") != canonical_key("https://acme.test/search?q=rust")


def test_a_trailing_slash_is_insignificant_but_the_root_path_keeps_one():
    assert canonical_key("https://acme.test/jobs/") == "https://acme.test/jobs"
    # The bare host and its root are the same page, and both keys read `https://acme.test/`.
    assert canonical_key("https://acme.test/") == canonical_key("https://acme.test")
    assert canonical_key("https://acme.test") == "https://acme.test/"


def test_different_pages_stay_different():
    assert not same_page("https://acme.test/jobs/1", "https://acme.test/jobs/2")
    assert same_page("https://acme.test/a?fbclid=1", "https://acme.test/a")


def test_input_that_is_not_a_url_never_becomes_a_shared_key():
    assert canonical_key("") == ""
    assert canonical_key("   ") == ""
    # Two unparseable strings must not collapse onto each other, or two unrelated mistakes
    # would be treated as the same page.
    assert canonical_key("not a url at all") != canonical_key("also not a url")
