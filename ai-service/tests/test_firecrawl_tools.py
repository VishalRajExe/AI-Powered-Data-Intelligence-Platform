from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.firecrawl.client import WebError, normalize_page, normalize_search, validated_http_url
from app.research.tools import domain_allowed


def test_search_results_are_read_from_the_web_channel():
    payload = SimpleNamespace(web=[
        SimpleNamespace(url="https://a.test", title="A", description="first"),
        {"url": "https://b.test", "title": "B"},
        {"title": "no url, skipped"},
    ])
    hits = normalize_search(payload, limit=5)
    assert [hit.url for hit in hits] == ["https://a.test", "https://b.test"]
    assert hits[0].snippet == "first"


def test_search_respects_the_result_limit():
    payload = {"web": [{"url": f"https://x{i}.test"} for i in range(10)]}
    assert len(normalize_search(payload, limit=3)) == 3


def test_search_of_an_unexpected_shape_returns_nothing_rather_than_guessing():
    assert normalize_search("a plain string", limit=5) == []


def test_page_metadata_supplies_url_and_title():
    payload = SimpleNamespace(
        markdown="# Title\nbody",
        metadata=SimpleNamespace(url="https://a.test/page", title="Page A", statusCode=200),
    )
    page = normalize_page(payload, fallback_url="https://ignored.test", truncate_chars=4000)
    assert (page.url, page.title, page.status_code) == ("https://a.test/page", "Page A", 200)
    assert page.markdown.startswith("# Title")


def test_long_pages_are_truncated_with_an_explicit_marker():
    payload = {"markdown": "x" * 50, "metadata": {"url": "https://a.test"}}
    page = normalize_page(payload, fallback_url="https://a.test", truncate_chars=10)
    # The budget applies to the retrieved content; the marker is appended to it, so a
    # reader can tell a short page apart from an amputated one.
    assert page.markdown.startswith("x" * 10)
    assert "x" * 11 not in page.markdown
    assert "truncated by the collection layer" in page.markdown


def test_non_http_schemes_are_refused_before_they_leave_the_process():
    """The model names URLs itself, so `file://` and `data:` must be rejected here."""
    for bad in ("file:///etc/passwd", "data:text/plain,hi", "gopher://x.test", "", "   "):
        with pytest.raises(WebError):
            validated_http_url(bad)
    assert validated_http_url("HTTPS://A.test/x") == "HTTPS://A.test/x"


def test_domain_policy_blocks_and_allows_by_registrable_host():
    assert domain_allowed("https://www.reddit.com/r/py", [], ["reddit.com"]) is False
    assert domain_allowed("https://youtube.test/c/x", [], ["reddit.com"]) is True
    assert domain_allowed("https://youtube.test/c/x", ["youtube.test"], []) is True
    assert domain_allowed("https://youtube.test/c/x", ["youtube.com"], []) is False
    assert domain_allowed("https://evil.test/x", ["youtube.test"], []) is False
    assert domain_allowed("not a url", [], []) is False


def test_a_blocked_domain_wins_over_an_allow_list():
    """An explicit block must not be bypassed by a broader allow entry."""
    assert domain_allowed("https://reddit.com/r/py", ["reddit.com"], ["reddit.com"]) is False


def test_subdomain_of_an_allowed_domain_passes():
    assert domain_allowed("https://blog.acme.com/post", ["acme.com"], []) is True
