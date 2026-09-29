"""`POST /ai/v1/research` — the Spring-facing entry point to the research graph.

Authenticated with the shared `X-API-Key`, like every internal endpoint.

A run that gathers insufficient evidence returns HTTP 200 with `status: FAILED` and a
`failureReason`, rather than an HTTP error, because the request itself was valid and the
work did run: the caller persists that outcome and decides what to do with it. Only a
provider transport failure becomes a 502.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from app.llm.client import LlmError
from app.research.contracts import ResearchRequest
from app.research.graph import ResearchGraph
from app.research.state import ResearchLimits
from app.security import require_api_key

router = APIRouter(dependencies=[Depends(require_api_key)])


@router.post("/research")
async def research(payload: ResearchRequest, request: Request):
    settings = request.app.state.settings
    limits = ResearchLimits(
        max_loops=payload.limits.max_loops if payload.limits else settings.max_loops,
        max_search_results=payload.limits.max_search_results if payload.limits else settings.max_search_results,
        max_searches_per_run=(
            payload.limits.max_searches_per_run if payload.limits else settings.max_searches_per_run
        ),
        max_scrapes_per_run=(
            payload.limits.max_scrapes_per_run if payload.limits else settings.max_scrapes_per_run
        ),
        expected_records=payload.limits.expected_records if payload.limits else None,
        allowed_domains=list(payload.limits.allowed_domains) if payload.limits else [],
        blocked_domains=list(payload.limits.blocked_domains) if payload.limits else [],
        model_id=settings.llm_model_id,
    )

    graph = ResearchGraph(
        llm=request.app.state.llm,
        web=request.app.state.web,
        settings=settings,
    )

    try:
        outcome = await graph.run(
            topic=payload.topic,
            extraction_schema=payload.extraction_schema,
            limits=limits,
            seed_queries=payload.seed_queries,
        )
    except LlmError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "AI_PROVIDER_UNAVAILABLE",
                "message": str(exc),
            },
        ) from exc

    return outcome.as_dict()
