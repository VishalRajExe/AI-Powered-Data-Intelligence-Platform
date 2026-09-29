"""The tests that matter most: a missing or fake credential must stop the process rather than
route execution to a simulated adapter."""
from __future__ import annotations

import pytest

from app.config import ConfigurationError, Settings


def construct(**overrides):
    base = {
        "ai_service_api_key": "a-real-shared-secret-of-sufficient-length-01234567",
        "gemini_api_key": "a-real-gemini-key-value",
        "firecrawl_api_key": "a-real-firecrawl-key",
        "_env_file": None,
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


def test_accepts_a_fully_configured_environment():
    settings = construct()
    assert settings.gemini_configured is True
    assert settings.firecrawl_configured is True


def test_missing_gemini_key_refuses_to_start():
    with pytest.raises(ConfigurationError, match="GEMINI_API_KEY"):
        construct(gemini_api_key="")


def test_missing_firecrawl_key_refuses_to_start():
    # The exact condition the old project shipped: DEMO_MODE=false with an empty Firecrawl key.
    with pytest.raises(ConfigurationError, match="FIRECRAWL_API_KEY"):
        construct(firecrawl_api_key="   ")


def test_missing_shared_key_refuses_to_start():
    with pytest.raises(ConfigurationError, match="AI_SERVICE_API_KEY"):
        construct(ai_service_api_key="")


def test_short_shared_key_is_rejected():
    with pytest.raises(ConfigurationError, match="AI_SERVICE_API_KEY"):
        construct(ai_service_api_key="too-short")


@pytest.mark.parametrize("marker", ["REPLACE_ME", "changeme-please", "your-api-key-here", "insecure-default-x"])
def test_placeholder_values_are_rejected(marker):
    with pytest.raises(ConfigurationError):
        construct(gemini_api_key=marker)


def test_all_problems_are_reported_at_once():
    with pytest.raises(ConfigurationError) as error:
        construct(gemini_api_key="", firecrawl_api_key="", ai_service_api_key="")
    message = str(error.value)
    assert "GEMINI_API_KEY" in message
    assert "FIRECRAWL_API_KEY" in message
    assert "AI_SERVICE_API_KEY" in message


def test_failure_message_never_echoes_the_value():
    canary = "short-canary-value"
    with pytest.raises(ConfigurationError) as error:
        construct(ai_service_api_key=canary)
    assert canary not in str(error.value)


def test_out_of_range_operational_limits_are_rejected():
    with pytest.raises(ConfigurationError, match="MAX_COLLECT_CONCURRENCY"):
        construct(max_collect_concurrency=0)
    with pytest.raises(ConfigurationError, match="MAX_SCHEMA_REPAIRS"):
        construct(max_schema_repairs=99)


def test_allowed_hosts_accepts_a_comma_separated_environment_value(monkeypatch):
    monkeypatch.delenv("ALLOWED_HOSTS", raising=False)
    monkeypatch.setenv("ALLOWED_HOSTS", "api.internal,  localhost ")
    settings = Settings(_env_file=None)
    assert settings.allowed_hosts == ["api.internal", "localhost"]
