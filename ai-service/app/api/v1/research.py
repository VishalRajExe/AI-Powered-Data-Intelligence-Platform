"""`POST /ai/v1/research` — the Spring-facing entry point to the research graph.

Authenticated with the shared `X-API-Key`, like every internal endpoint.

A run that gathers insufficient evidence returns HTTP 200 with `status: FAILED` and a
`failureReason`, rather than an HTTP error, because the request itself was valid and the
work did run: the caller persists that outcome and decides what to do with it. Only a
provider transport failure becomes a 502.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field, field_validator

from app.config import Settings
from app.contracts import CamelModel
from app.llm.client import LlmError
from app.research.contracts import ResearchLimitsRequest, ResearchRequest
from app.research.graph import ResearchGraph
from app.research.state import ResearchLimits
from app.requirements.schema import expected_records
from app.requirements.service import RequirementAnalysis, RequirementAnalysisError, RequirementAnalyzer
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


class FromPromptRequest(CamelModel):
    """The full flow in one call: prompt → requirement → data contract → extraction
    schema → research graph. Callers may still run the stages separately."""

    prompt: str = Field(min_length=8, max_length=4000)
    limits: ResearchLimitsRequest | None = None

    @field_validator("prompt")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("prompt must contain real text")
        return value.strip()


@router.post("/research/from-prompt")
async def research_from_prompt(payload: FromPromptRequest, request: Request):
    settings = request.app.state.settings
    analyzer = RequirementAnalyzer(llm=request.app.state.llm, settings=settings)

    try:
        analysis = await analyzer.analyze(payload.prompt)
    except LlmError as exc:
        raise HTTPException(status_code=502, detail={"code": "AI_PROVIDER_UNAVAILABLE",
                                                     "message": str(exc)}) from exc
    except RequirementAnalysisError as exc:
        raise HTTPException(status_code=502, detail={"code": "REQUIREMENT_ANALYSIS_FAILED",
                                                     "message": str(exc)}) from exc

    envelope = {
        "requirement": analysis.requirement_json(),
        "extractionSchema": analysis.extraction_schema,
        "metadata": {"model": analysis.model_id, "repairAttempts": analysis.repair_attempts,
                     "fieldCount": len(analysis.requirement.fields)},
    }

    if analysis.status != "valid":
        # The contract is unresolved, so collection must not start. Answering 200 with an
        # explicit status keeps this a decision for the caller rather than a transport error.
        return {
            **envelope,
            "status": "NEEDS_CLARIFICATION",
            "clarificationQuestions": analysis.clarification_questions,
            "research": None,
        }

    limits = analysis_limits(payload.limits, settings, analysis)
    graph = ResearchGraph(llm=request.app.state.llm, web=request.app.state.web, settings=settings)
    try:
        outcome = await graph.run(
            topic=analysis.brief,
            extraction_schema=analysis.extraction_schema,
            limits=limits,
            seed_queries=analysis.search_queries,
        )
    except LlmError as exc:
        raise HTTPException(status_code=502, detail={"code": "AI_PROVIDER_UNAVAILABLE",
                                                     "message": str(exc)}) from exc

    return {**envelope, "status": outcome.status, "clarificationQuestions": [],
            "research": outcome.as_dict()}


def analysis_limits(limits: ResearchLimitsRequest | None, settings: Settings,
                    analysis: RequirementAnalysis) -> ResearchLimits:
    resolved = limits or ResearchLimitsRequest()
    return ResearchLimits(
        max_loops=resolved.max_loops if resolved.max_loops is not None else settings.max_loops,
        max_search_results=(resolved.max_search_results if resolved.max_search_results is not None
                            else settings.max_search_results),
        max_searches_per_run=(resolved.max_searches_per_run if resolved.max_searches_per_run is not None
                              else settings.max_searches_per_run),
        max_scrapes_per_run=(resolved.max_scrapes_per_run if resolved.max_scrapes_per_run is not None
                             else settings.max_scrapes_per_run),
        expected_records=resolved.expected_records if resolved.expected_records is not None
        else expected_records(analysis.requirement),
        allowed_domains=list(resolved.allowed_domains),
        blocked_domains=list(resolved.blocked_domains),
        model_id=settings.llm_model_id,
    )
