"""Requirement analysis endpoint.

`POST /ai/v1/requirements/analyze` is authenticated and returns the structured requirement
plus the extraction schema derived from it, so a caller can inspect the contract before any
collection happens.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field, field_validator

from app.contracts import CamelModel
from app.llm.client import LlmError
from app.requirements.service import RequirementAnalysisError, RequirementAnalyzer
from app.security import require_api_key

router = APIRouter(dependencies=[Depends(require_api_key)])


class AnalyzeRequest(CamelModel):
    prompt: str = Field(min_length=8, max_length=4000)

    @field_validator("prompt")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("prompt must contain real text")
        return value.strip()


@router.post("/requirements/analyze")
async def analyze(payload: AnalyzeRequest, request: Request):
    analyzer = RequirementAnalyzer(llm=request.app.state.llm, settings=request.app.state.settings)
    try:
        analysis = await analyzer.analyze(payload.prompt)
    except LlmError as exc:
        raise HTTPException(status_code=502,
                            detail={"code": "AI_PROVIDER_UNAVAILABLE", "message": str(exc)}) from exc
    except RequirementAnalysisError as exc:
        # Fail closed: the caller gets the reason, not a defaulted requirement.
        raise HTTPException(status_code=502,
                            detail={"code": "REQUIREMENT_ANALYSIS_FAILED", "message": str(exc)}) from exc

    return analysis.as_dict()
