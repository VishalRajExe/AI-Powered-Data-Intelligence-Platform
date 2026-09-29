"""Configuration. Fails loud: a missing required credential must abort startup.

There is deliberately no demo mode, no silent fallback, and no default credential. An absent or
placeholder key stops the process — the inversion of the old project, where an empty
FIRECRAWL_API_KEY quietly routed every collection through a simulated adapter while reporting
`configured: true`.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

MIN_SHARED_SECRET_LENGTH = 32
MIN_PROVIDER_KEY_LENGTH = 12

PLACEHOLDER_MARKERS = (
    "changeme", "change_me", "replace_me", "replace-me", "your-", "your_",
    "dummy", "placeholder", "secret123", "insecure-default", "todo",
)


class ConfigurationError(RuntimeError):
    """Raised when the environment cannot support a real run."""


def _reject_placeholder(variable: str, value: str, min_length: int) -> list[str]:
    lowered = value.lower()
    for marker in PLACEHOLDER_MARKERS:
        if marker in lowered:
            return [f"{variable} looks like a placeholder value; supply a real secret."]
    if len(value) < min_length:
        return [
            f"{variable} must be at least {min_length} characters (got {len(value)}). "
            "Generate one with: openssl rand -hex 32"
        ]
    return []


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # One .env at the repository root is the single source of truth; the tuple keeps a
        # per-service override possible without requiring a second copy of every secret.
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- required, no defaults ---
    ai_service_api_key: str = ""
    gemini_api_key: str = ""
    firecrawl_api_key: str = ""

    # --- topology and limits, safe defaults ---
    app_env: str = "development"
    log_level: str = "info"
    ai_service_port: int = 8000
    ai_service_host: str = "127.0.0.1"
    # NoDecode: pydantic-settings would otherwise JSON-parse list fields from the environment and
    # reject the plain comma-separated form a .env file is written in.
    allowed_hosts: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["localhost", "127.0.0.1", "::1"]
    )

    llm_model_id: str = "gemini-2.5-flash"
    firecrawl_base_url: str = "https://api.firecrawl.dev"

    llm_request_timeout_seconds: float = 45.0
    extract_timeout_seconds: float = 180.0
    interact_timeout_seconds: float = 60.0
    scrape_timeout_seconds: float = 60.0

    max_schema_repairs: int = 3
    max_collect_concurrency: int = 5
    markdown_truncate_chars: int = 4000
    markdown_truncate_with_extract: int = 2000

    # --- research graph bounds (ported from data-enrichment-js configuration.ts, minus
    #     maxInfoToolCalls, which that repo declares and defaults but never reads) ---
    max_loops: int = 6
    max_search_results: int = 5
    max_scrapes_per_run: int = 12
    max_searches_per_run: int = 8

    @field_validator("allowed_hosts", mode="before")
    @classmethod
    def _split_hosts(cls, value):
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return value

    @model_validator(mode="after")
    def _require_real_credentials(self) -> "Settings":
        problems: list[str] = []

        for variable, value, min_length in (
            ("AI_SERVICE_API_KEY", self.ai_service_api_key, MIN_SHARED_SECRET_LENGTH),
            ("GEMINI_API_KEY", self.gemini_api_key, MIN_PROVIDER_KEY_LENGTH),
            ("FIRECRAWL_API_KEY", self.firecrawl_api_key, MIN_PROVIDER_KEY_LENGTH),
        ):
            if not value.strip():
                problems.append(f"{variable} is required and is empty or unset.")
            else:
                problems.extend(_reject_placeholder(variable, value, min_length))

        if not (1 <= self.ai_service_port <= 65535):
            problems.append("AI_SERVICE_PORT must be between 1 and 65535.")
        if self.max_schema_repairs < 0 or self.max_schema_repairs > 10:
            problems.append("MAX_SCHEMA_REPAIRS must be between 0 and 10.")
        if self.max_collect_concurrency < 1 or self.max_collect_concurrency > 32:
            problems.append("MAX_COLLECT_CONCURRENCY must be between 1 and 32.")
        if not 1 <= self.max_loops <= 20:
            problems.append("MAX_LOOPS must be between 1 and 20; the research loop is bounded.")
        if not 1 <= self.max_search_results <= 20:
            problems.append("MAX_SEARCH_RESULTS must be between 1 and 20.")
        if not 1 <= self.max_scrapes_per_run <= 100:
            problems.append("MAX_SCRAPES_PER_RUN must be between 1 and 100.")
        if not 1 <= self.max_searches_per_run <= 100:
            problems.append("MAX_SEARCHES_PER_RUN must be between 1 and 100.")
        for name, value in (
            ("SCRAPE_TIMEOUT_SECONDS", self.scrape_timeout_seconds),
            ("LLM_REQUEST_TIMEOUT_SECONDS", self.llm_request_timeout_seconds),
            ("INTERACT_TIMEOUT_SECONDS", self.interact_timeout_seconds),
        ):
            if value <= 0:
                problems.append(f"{name} must be greater than zero.")

        if problems:
            raise ConfigurationError(
                "FINALAIAGENT ai-service refused to start. Fix the following configuration "
                "problems (values are never printed):\n  - " + "\n  - ".join(problems)
            )
        return self

    @property
    def gemini_configured(self) -> bool:
        return bool(self.gemini_api_key.strip())

    @property
    def firecrawl_configured(self) -> bool:
        return bool(self.firecrawl_api_key.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
