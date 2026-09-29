"""Requirement analysis: natural language in, validated contract out — or nothing.

Malformed model output is repaired a bounded number of times and then **fails**. It is never
substituted with a default requirement, which is the exact behaviour that made the old
project answer every prompt with the same startup schema
(`docs/audit/00-FORENSIC-AUDIT.md` §1: `requirements/index.ts:17-19`).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.config import Settings
from app.contracts import Requirement
from app.llm.client import LlmClient, LlmOutputUnparsable
from app.requirements.schema import (
    REQUIREMENT_JSON_SCHEMA,
    build_research_brief,
    derive_extraction_schema,
)

PROMPT_FILE = Path(__file__).parent / "prompts" / "requirement.md"

STATUS_VALID = "valid"
STATUS_NEEDS_CLARIFICATION = "needs_clarification"


class RequirementAnalysisError(RuntimeError):
    """The model could not produce a usable requirement. Nothing is substituted for it."""


@dataclass(slots=True)
class RequirementAnalysis:
    requirement: Requirement
    extraction_schema: dict[str, Any]
    search_queries: list[str]
    brief: str
    status: str
    repair_attempts: int
    clarification_questions: list[str] = field(default_factory=list)
    model_id: str = ""

    def requirement_json(self) -> dict[str, Any]:
        return self.requirement.model_dump(by_alias=True, mode="json", exclude_none=True)

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "requirement": self.requirement_json(),
            "extractionSchema": self.extraction_schema,
            "searchQueries": self.search_queries,
            "researchBrief": self.brief,
            "clarificationQuestions": self.clarification_questions,
            "metadata": {
                "model": self.model_id,
                "repairAttempts": self.repair_attempts,
                "fieldCount": len(self.requirement.fields),
            },
        }


class RequirementAnalyzer:
    def __init__(self, *, llm: LlmClient, settings: Settings) -> None:
        self._llm = llm
        self._settings = settings
        self._system = (
            "You convert a business data request into a structured collection requirement. "
            "Analyse only; do not collect, browse, or answer the underlying question."
        )

    async def analyze(self, prompt: str) -> RequirementAnalysis:
        if not prompt or not prompt.strip():
            raise RequirementAnalysisError("a data request is required")

        template = PROMPT_FILE.read_text(encoding="utf-8")
        issues: list[str] = []

        for attempt in range(self._settings.max_schema_repairs + 1):
            payload = await self._llm.generate_json(
                system=self._system,
                prompt=_render(template, prompt=prompt, issues=issues),
                json_schema=REQUIREMENT_JSON_SCHEMA,
            )

            try:
                requirement = Requirement.model_validate(payload.get("requirement") or {})
            except (ValidationError, TypeError, AttributeError) as exc:
                issues = _explain(exc)
                if attempt >= self._settings.max_schema_repairs:
                    raise RequirementAnalysisError(
                        "the requirement model never produced a valid contract after "
                        f"{self._settings.max_schema_repairs} repairs: {'; '.join(issues)}"
                    ) from exc
                continue

            queries = [str(q) for q in (payload.get("search_queries") or []) if str(q).strip()]
            questions = [str(q) for q in (payload.get("clarification_questions") or []) if str(q).strip()]
            status = requirement.validation_status

            if status == STATUS_NEEDS_CLARIFICATION and not questions:
                # A requirement that cannot proceed must say what it needs, rather than
                # silently stalling a caller that would otherwise continue.
                questions = [f"Please clarify: {item}" for item in requirement.missing_information]

            return RequirementAnalysis(
                requirement=requirement,
                extraction_schema=derive_extraction_schema(requirement),
                search_queries=queries,
                brief=build_research_brief(requirement),
                status=status,
                repair_attempts=attempt,
                clarification_questions=questions,
                model_id=self._settings.llm_model_id,
            )

        raise RequirementAnalysisError("requirement analysis exhausted its repair budget")


def _render(template: str, *, prompt: str, issues: list[str]) -> str:
    feedback = ""
    if issues:
        feedback = (
            "\n\n## Your previous answer was rejected\n\n"
            "Fix exactly these and answer again in full:\n- " + "\n- ".join(issues) + "\n"
        )
    rendered = template.replace("{prompt}", prompt)
    marker = "<request>"
    if feedback and marker in rendered:
        return rendered.replace(marker, feedback + marker, 1)
    return rendered + feedback


def _explain(exc: Exception) -> list[str]:
    """Model-readable description of what was wrong with its own output."""
    if isinstance(exc, ValidationError):
        return [
            f"{'.'.join(str(part) for part in error['loc']) or '(root)'}: {error['msg']}"
            for error in exc.errors()
        ][:12]
    return [f"{type(exc).__name__}: {exc}"]
