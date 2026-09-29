"""Configuration. Fails loud: a missing required credential must abort startup.

There is deliberately no demo mode, no silent fallback, no default credential.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- required (startup fails without these) ---
    ai_service_api_key: str
    gemini_api_key: str
    firecrawl_api_key: str

    # --- optional with safe defaults ---
    app_env: str = "development"
    llm_model_id: str = "gemini-2.5-flash"
    firecrawl_base_url: str = "https://api.firecrawl.dev"
    llm_request_timeout_seconds: float = 45.0
    extract_timeout_seconds: float = 180.0
    interact_timeout_seconds: float = 60.0
    max_schema_repairs: int = 3
    max_collect_concurrency: int = 5
    markdown_truncate_chars: int = 4000
    markdown_truncate_with_extract: int = 2000

    @property
    def firecrawl_configured(self) -> bool:
        return bool(self.firecrawl_api_key)

    @property
    def llm_configured(self) -> bool:
        return bool(self.gemini_api_key)


def _validate(s: Settings) -> Settings:
    missing = [
        name
        for name in ("ai_service_api_key", "gemini_api_key", "firecrawl_api_key")
        if not getattr(s, name)
    ]
    if missing:
        raise RuntimeError(
            "Missing required environment variables (no fallback exists, refusing to start): "
            + ", ".join(name.upper() for name in missing)
        )
    return s


@lru_cache
def get_settings() -> Settings:
    return _validate(Settings())
