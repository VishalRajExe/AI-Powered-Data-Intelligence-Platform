"""`POST /ai/v1/quality/process` — the data-intelligence pipeline.

Raw records in; normalized, validated, deduplicated, resolved, conflict-annotated records plus a
quality report out. Stateless, like every other endpoint here: no model call, no database, nothing
to lose on restart.

Declared `def` rather than `async def` on purpose. The pipeline is CPU-bound pure Python, and an
`async def` handler would run it on the event loop and stall every other request for the duration;
a synchronous handler is dispatched to FastAPI's threadpool instead. That is also what the
async-correctness test in `H-ai-service-design.md` §H.9 is about, from the other direction: no
blocking call belongs inside a coroutine.

Its output is **advisory**. Spring re-enforces required fields, types and evidence presence before
anything is persisted (`A-final-architecture.md` §A.2), so a bug here can cost a re-run but cannot
put an unchecked row into a dataset.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.quality.contracts import QualityRequest, QualityResult
from app.quality.pipeline import process
from app.security import require_api_key

router = APIRouter(dependencies=[Depends(require_api_key)])


@router.post("/quality/process", response_model=QualityResult)
def quality_process(payload: QualityRequest, request: Request) -> QualityResult:
    return process(payload, request.app.state.settings)
