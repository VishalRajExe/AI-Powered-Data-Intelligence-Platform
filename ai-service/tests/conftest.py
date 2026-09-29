"""Test environment.

These variables are assigned before any ``app`` module import because ``app.main`` builds the
FastAPI instance at module level and the configuration layer refuses to start without them —
the same rule production follows.
"""
from __future__ import annotations

import os

TEST_ENVIRONMENT = {
    "APP_ENV": "test",
    "LOG_LEVEL": "warning",
    "AI_SERVICE_API_KEY": "test-only-shared-key-value-0123456789abcdef",
    "GEMINI_API_KEY": "test-only-gemini-key-0123456789",
    "FIRECRAWL_API_KEY": "test-only-firecrawl-key-0123456789",
    "ALLOWED_HOSTS": "testserver,localhost,127.0.0.1",
}

for key, value in TEST_ENVIRONMENT.items():
    os.environ[key] = value

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402

VALID_SHARED_KEY = "test-only-shared-key-value-0123456789abcdef"


def build_settings(**overrides) -> Settings:
    base = {
        "ai_service_api_key": VALID_SHARED_KEY,
        "gemini_api_key": "test-only-gemini-key-0123456789",
        "firecrawl_api_key": "test-only-firecrawl-key-0123456789",
        "allowed_hosts": ["testserver", "localhost", "127.0.0.1"],
        "_env_file": None,
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


@pytest.fixture
def settings() -> Settings:
    return build_settings()


@pytest.fixture
def client(settings: Settings) -> TestClient:
    with TestClient(create_app(settings)) as test_client:
        yield test_client
