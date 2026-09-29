from __future__ import annotations

from app.llm.client import _detail


def test_provider_error_detail_is_truncated():
    long_error = ValueError("x" * 5000)
    assert len(_detail(long_error, secret="")) <= 420


def test_provider_error_detail_never_carries_the_api_key():
    leaked = ValueError("request to key AIzaSyDEXAMPLEkeyvalue1234567890abcd failed")
    scrubbed = _detail(leaked, "AIzaSyDEXAMPLEkeyvalue1234567890abcd")
    assert "AIzaSyDEXAMPLEkeyvalue" not in scrubbed
    assert "***" in scrubbed


def test_detail_keeps_the_useful_part():
    text = _detail(RuntimeError("429 resource exhausted"), secret="")
    assert "RuntimeError" in text and "429 resource exhausted" in text
