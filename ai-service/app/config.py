"""Configuration. Fails loud: a missing required credential must abort startup.

There is deliberately no demo mode, no silent fallback, and no default credential. An absent or
placeholder key stops the process — the inversion of the old project, where an empty
FIRECRAWL_API_KEY quietly routed every collection through a simulated adapter while reporting
`configured: true`.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from app.contracts import RetryPolicy

MIN_SHARED_SECRET_LENGTH = 32
MIN_PROVIDER_KEY_LENGTH = 12

# The web tools the Firecrawl client implements. `map`, `crawl`, `extract` and `bash` are
# available from the SDK but deliberately not in this set: the graph's contract is
# evidenced page content, and a crawl or an extract would outrun its budget accounting.
KNOWN_WEB_TOOLS = frozenset({"search", "scrape", "interact"})

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
    # `interact_timeout_seconds` is a hard deadline on one browser session, ported from
    # `toolkit.ts:4` (DEFAULT_INTERACT_TIMEOUT_MS = 60_000). Upstream disables the deadline
    # at <= 0; this service refuses that, because a stuck session then hangs the research
    # loop with no bound at all.
    interact_timeout_seconds: float = 60.0
    scrape_timeout_seconds: float = 60.0
    search_timeout_seconds: float = 30.0

    max_schema_repairs: int = 3
    max_collect_concurrency: int = 5
    # Browser sessions are not cheap requests: upstream bars them from parallel workers
    # outright (`worker/index.ts:61`). A separate, smaller cap keeps one interactive run
    # from starving the scrape queue that feeds it.
    max_interact_concurrency: int = 2
    markdown_truncate_chars: int = 4000
    markdown_truncate_with_extract: int = 2000

    # --- research graph bounds (ported from data-enrichment-js configuration.ts, minus
    #     maxInfoToolCalls, which that repo declares and defaults but never reads) ---
    max_loops: int = 6
    max_search_results: int = 5
    max_scrapes_per_run: int = 12
    max_searches_per_run: int = 8
    max_interactions_per_run: int = 3

    # --- web tool ceiling ---
    # `agent-core/src/toolkit.ts:188-204` builds a filtered toolkit from an allowlist the
    # caller supplies. Here the allowlist is two-sided: this setting is the maximum any
    # request may ask for, and a request may only narrow it. `interact` is therefore off
    # until an operator enables it, because a browser session is the one web tool that can
    # act on a page rather than only read it.
    allowed_web_tools: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["search", "scrape"]
    )

    # --- skills ---
    # `agent-core` ships six SKILL.md playbooks. None are copied here (licence and
    # provenance: docs/audit/C-repository-reuse-map.md); this points at a directory we own.
    # An empty or missing directory is a valid state — the graph runs with no playbooks.
    skills_dir: str = "skills/definitions"

    # --- source curation (Phase 5) ---
    # Retry is bounded by the same RetryPolicy contract the workflow plan uses; without these
    # the contract is decoration. `web-research-agent-master` shipped retries=3 in its README
    # while calling fetch_page(url, 1), i.e. none — the bound is set here and read there.
    retry_max_attempts: int = 3
    retry_base_delay_seconds: float = 1.0
    retry_max_delay_seconds: float = 20.0

    robots_enabled: bool = True
    robots_timeout_seconds: float = 5.0
    robots_user_agent: str = "finalagent-research"
    # What to do when robots.txt cannot be read (5xx, DNS failure, timeout). "restrict" refuses
    # the source and says why; "allow" fetches it and marks the run as having proceeded blind.
    robots_on_error: Literal["restrict", "allow"] = "restrict"

    max_sources_per_domain: int = 2
    # 0.0 means rank-only: the scrape budget decides how many pages are read, and nothing is
    # dropped for vocabulary mismatch unless an operator sets a floor.
    min_relevance_score: float = 0.0
    max_candidates_per_search: int = 8

    @field_validator("allowed_web_tools", mode="before")
    @classmethod
    def _split_tools(cls, value):
        if isinstance(value, str):
            return [part.strip().lower() for part in value.split(",") if part.strip()]
        return value

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
        if self.max_interact_concurrency < 1 or self.max_interact_concurrency > 4:
            problems.append("MAX_INTERACT_CONCURRENCY must be between 1 and 4; a browser session is "
                            "expensive enough that upstream forbids them in parallel workers entirely.")
        if not 0 <= self.max_interactions_per_run <= 20:
            problems.append("MAX_INTERACTIONS_PER_RUN must be between 0 and 20 (0 disables interact).")
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
            ("SEARCH_TIMEOUT_SECONDS", self.search_timeout_seconds),
            ("LLM_REQUEST_TIMEOUT_SECONDS", self.llm_request_timeout_seconds),
            ("INTERACT_TIMEOUT_SECONDS", self.interact_timeout_seconds),
        ):
            if value <= 0:
                problems.append(f"{name} must be greater than zero.")

        unknown_tools = [t for t in self.allowed_web_tools if t not in KNOWN_WEB_TOOLS]
        if unknown_tools:
            problems.append(f"ALLOWED_WEB_TOOLS names unknown tools: {unknown_tools}. "
                            f"Known: {sorted(KNOWN_WEB_TOOLS)}.")
        if not self.allowed_web_tools:
            problems.append("ALLOWED_WEB_TOOLS must list at least one web tool; with none enabled "
                            "the research graph cannot gather evidence.")

        if not 1 <= self.retry_max_attempts <= 5:
            problems.append("RETRY_MAX_ATTEMPTS must be between 1 and 5; it bounds the RetryPolicy "
                            "contract the workflow plan already carries.")
        if self.retry_base_delay_seconds <= 0:
            problems.append("RETRY_BASE_DELAY_SECONDS must be greater than zero.")
        if self.retry_max_delay_seconds < self.retry_base_delay_seconds:
            problems.append("RETRY_MAX_DELAY_SECONDS must be at least RETRY_BASE_DELAY_SECONDS; "
                            "a cap below the first wait would be silently ignored.")
        if not 0 <= self.min_relevance_score <= 1:
            problems.append("MIN_RELEVANCE_SCORE must be between 0 and 1 (0 ranks without dropping).")
        if not 0 <= self.max_sources_per_domain <= 10:
            problems.append("MAX_SOURCES_PER_DOMAIN must be between 0 (no rule) and 10.")
        if not 1 <= self.max_candidates_per_search <= 20:
            problems.append("MAX_CANDIDATES_PER_SEARCH must be between 1 and 20.")
        if self.robots_timeout_seconds <= 0:
            problems.append("ROBOTS_TIMEOUT_SECONDS must be greater than zero.")
        if not self.robots_user_agent.strip():
            problems.append("ROBOTS_USER_AGENT must name the token we ask robots.txt about.")
        if len(self.robots_user_agent.split()) != 1:
            problems.append("ROBOTS_USER_AGENT must be a single token; robots.txt rules match on "
                            "user-agent substrings, and a phrase would match unpredictably.")

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
    def retry_policy(self) -> "RetryPolicy":
        """The single source of the retry bound the web layer obeys."""
        return RetryPolicy(max_attempts=self.retry_max_attempts, strategy="exponential")
    @property
    def firecrawl_configured(self) -> bool:
        return bool(self.firecrawl_api_key.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
