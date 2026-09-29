"""Masking parity with the Java side (SecretMaskingConverterTest): the same shapes must be caught
on both services, or a value logged in one process escapes in the other."""
from __future__ import annotations

import logging

from app.logging_setup import MaskingFilter, mask


def test_masks_keyed_assignment():
    assert mask("GEMINI_API_KEY=abc123def456ghi789") == "GEMINI_API_KEY=***"


def test_masks_keyed_json_values():
    masked = mask('{"apiKey": "fc-abcdefghijklmnopqrst"}')
    assert "fc-abcdefghijklmnopqrst" not in masked
    assert "apiKey" in masked


def test_masks_bare_provider_key_shapes():
    assert "AIzaSyA" not in mask("using AIzaSyA1234567890abcdefghijKLmnopQRSTUV")
    assert "ghp_abcdefgh" not in mask("token was ghp_abcdefghijklmnopqrstuvwxyz0123456789")


def test_masks_signed_jwt():
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftQ8m1kKx2n3p4q5r6s7t"
    assert "eyJhbGciOiJIUzI1NiJ9" not in mask("rejected bearer " + jwt)


def test_masks_connection_string_credentials():
    assert "S3cr3tPass" not in mask("jdbc:mysql://finalagent:S3cr3tPass@127.0.0.1:3306/db")


def test_leaves_ordinary_messages_alone():
    message = "Workflow run 42 completed with 12 valid records and 2 duplicates"
    assert mask(message) == message


def test_the_filter_rewrites_the_record_message():
    record = logging.LogRecord(
        name="t", level=logging.INFO, pathname=__file__, lineno=1,
        msg="connecting with FIRECRAWL_API_KEY=fc-reallookingkey123", args=(), exc_info=None,
    )
    assert MaskingFilter().filter(record) is True
    assert "fc-reallookingkey123" not in record.getMessage()
