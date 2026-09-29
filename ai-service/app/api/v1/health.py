"""Health and readiness for the AI service.

`/health` is public because the backend's readiness probe has to reach it before deciding
whether the boundary is healthy. `/ready` is authenticated: it exposes more about how this
service is configured.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from app.security import require_api_key

router = APIRouter()

SERVICE_NAME = "finalagent-ai-service"
VERSION = "0.1.0"


@router.get("/health")
def health(request: Request) -> dict[str, Any]:
    settings = request.app.state.settings
    return {
        "status": "UP",
        "service": SERVICE_NAME,
        "version": VERSION,
        "credentials": {
            "geminiApiConfigured": settings.gemini_configured,
            "firecrawlApiConfigured": settings.firecrawl_configured,
            "inboundAuthRequired": True,
        },
    }


@router.get("/ready", dependencies=[Depends(require_api_key)])
def ready(request: Request) -> dict[str, Any]:
    settings = request.app.state.settings
    return {
        "status": "UP",
        "service": SERVICE_NAME,
        "version": VERSION,
        "checks": {
            "configuration": {"status": "UP"},
            "credentials": {
                "status": "UP",
                "gemini": "present",
                "firecrawl": "present",
            },
            "providers": {
                "status": "NOT_ATTEMPTED",
                "reason": "Phase 1 verifies configuration presence only. Live Gemini and "
                          "Firecrawl calls are made and measured in the Phase 2 provider spike.",
            },
            "persistence": {
                "status": "NOT_APPLICABLE",
                "reason": "This service is stateless by design; Spring Boot owns MySQL.",
            },
        },
        "limits": {
            "maxSchemaRepairs": settings.max_schema_repairs,
            "maxCollectConcurrency": settings.max_collect_concurrency,
            "maxInteractConcurrency": settings.max_interact_concurrency,
            "maxInteractionsPerRun": settings.max_interactions_per_run,
            "searchTimeoutSeconds": settings.search_timeout_seconds,
            "scrapeTimeoutSeconds": settings.scrape_timeout_seconds,
            "interactTimeoutSeconds": settings.interact_timeout_seconds,
            "llmModelId": settings.llm_model_id,
        },
        "web": {
            # Which tools the ceiling exposes, plus whether the attached web engine can
            # actually service them. A run whose request was silently narrowed by the
            # ceiling should be visible here rather than inferred from a FAILED job.
            "engine": type(request.app.state.web).__name__,
            "enabledTools": list(settings.allowed_web_tools),
            "interactSupportedByEngine": hasattr(request.app.state.web, "interact"),
        },
        "skills": {
            "directory": str(request.app.state.skills.skills_dir),
            "loaded": len(request.app.state.skills.skills),
            "rejected": len(request.app.state.skills.rejected),
            "sitePlaybooks": sum(len(skill.site_playbooks) for skill in request.app.state.skills.skills),
        },
    }
