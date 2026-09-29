"""The research graph.

A faithful port of `data-enrichment-js/src/enrichment_agent/graph.ts`, expressed as an
explicit named-node state machine instead of a LangGraph program — see decision L2 in
`docs/control/Memory.md`. The topology is preserved, not collapsed into one LLM call:

| template node / router | here |
|---|---|
| `callAgentModel` (`graph.ts:43-109`) | `plan_action` — the model chooses one action |
| `Info` dummy tool (`graph.ts:52-56`) | `submit_extraction` — schema forced as the response shape |
| `tools` / `toolNode` (`tools.ts:92-142`) | `run_tools` |
| `reflect` (`graph.ts:155-225`) | `critique` |
| `routeAfterAgent` (`graph.ts:234-254`) | `_route_after_action` |
| `routeAfterChecker` (`graph.ts:266-291`) | `_route_after_critique` |

Two structural improvements over the template, both called out in
`docs/audit/O-new-repositories-integration-analysis.md` §O.4:

1. **The bound gates every path.** Their `maxLoops` was only consulted by the
   post-critique router, so a run that kept searching never met it. Here the budget is
   checked before every model turn and again per search and per scrape.
2. **Running out of budget is never success.** Their router returned `__end__` on
   exhaustion as though the run had finished; here it yields `FAILED` with the reason.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Any

from app.config import Settings
from app.extraction.schema_validate import field_checklist, validate_against_schema
from app.firecrawl.client import WebTool
from app.llm.client import LlmClient
from app.research import prompts, tools
from app.research.state import Message, ResearchLimits, ResearchState

STATUS_COMPLETED = "COMPLETED"
STATUS_COMPLETED_WITH_WARNINGS = "COMPLETED_WITH_WARNINGS"
STATUS_FAILED = "FAILED"

VALID_ACTIONS = ("search", "scrape", "submit", "blocked")
_URL_IN_VALUE = re.compile(r"https?://[^\s\"'<>)\]]+", re.IGNORECASE)


@dataclass(slots=True)
class ResearchOutcome:
    status: str
    records: list[dict[str, Any]]
    sources: list[dict[str, Any]]
    metadata: dict[str, Any]
    validation: dict[str, Any]
    failure_reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        payload = {
            "status": self.status,
            "records": self.records,
            "sources": self.sources,
            "metadata": self.metadata,
            "validation": self.validation,
        }
        if self.failure_reason:
            payload["failureReason"] = self.failure_reason
        return payload


@dataclass(slots=True)
class _Critique:
    satisfactory: bool | None
    reasons: list[str]
    instructions: str
    malformed: bool = False


class ResearchGraph:
    """Node names and edges are declared so the topology is inspectable, not implied."""

    NODES = ("plan_action", "run_tools", "submit_extraction", "critique")
    EDGES = {
        "plan_action": ("run_tools", "submit_extraction", "end"),
        "run_tools": ("plan_action",),
        "submit_extraction": ("critique", "plan_action", "end"),
        "critique": ("end", "plan_action"),
    }

    def __init__(self, *, llm: LlmClient, web: WebTool, settings: Settings) -> None:
        self._llm = llm
        self._web = web
        self._settings = settings

    async def run(
        self,
        *,
        topic: str,
        extraction_schema: dict[str, Any],
        limits: ResearchLimits | None = None,
        seed_queries: list[str] | None = None,
    ) -> ResearchOutcome:
        resolved = limits or ResearchLimits(
            max_loops=self._settings.max_loops,
            max_search_results=self._settings.max_search_results,
            max_searches_per_run=self._settings.max_searches_per_run,
            max_scrapes_per_run=self._settings.max_scrapes_per_run,
            model_id=self._settings.llm_model_id,
        )
        state = ResearchState(topic=topic, extraction_schema=extraction_schema, limits=resolved)
        checklist = field_checklist(extraction_schema)
        started = time.perf_counter()

        for query in (seed_queries or [])[: resolved.max_searches_per_run]:
            await self._collect(state, {"action": "search", "query": query})

        while True:
            if not state.budget.model_allowed():
                return self._fail(
                    state,
                    reason=state.budget.exhausted_reason()
                           or f"research loop reached its bound of {state.budget.max_loops} iterations",
                    started=started,
                    checklist=checklist,
                )

            state.budget.note_loop()
            action = await self._plan_action(state, checklist)
            kind = str(action.get("action", "")).strip().lower()

            if kind not in VALID_ACTIONS:
                state.feedback = f"'{kind}' is not one of {', '.join(VALID_ACTIONS)}. Choose one and act."
                state.add(Message(role="tool", content=state.feedback, name="plan_action", status="error"))
                continue

            if kind == "blocked":
                return self._fail(
                    state,
                    reason=f"the agent reported the contract cannot be satisfied from public sources: "
                           f"{action.get('reason')}",
                    started=started,
                    checklist=checklist,
                )

            if kind in ("search", "scrape"):
                outcome = await self._collect(state, action)
                if not outcome.ok:
                    state.tool_errors.append(outcome.error or "tool failed")
                continue

            # kind == "submit"
            if not state.has_tool_data():
                # Gate 2, ported from `agent.ts:37-40,42-66`: no answer before data.
                state.feedback = (
                    "Nothing has been retrieved yet this run. Call search or scrape before "
                    "submitting; a result built from prior knowledge is not acceptable."
                )
                state.add(Message(role="tool", content=state.feedback, name="submit", status="error"))
                continue

            submitted = await self._submit_extraction(state, checklist)

            gate = validate_against_schema(extraction_schema, submitted)
            if not gate.ok:
                if state.repair_attempts < self._settings.max_schema_repairs:
                    state.repair_attempts += 1
                    state.feedback = (
                        "The submission does not satisfy the contract. Fix exactly these and resubmit:\n- "
                        + "\n- ".join(gate.issues())
                    )
                    state.add(Message(role="tool", content=state.feedback, name="submit", status="error"))
                    continue
                return self._fail(
                    state,
                    reason="submitted data never satisfied the extraction schema after "
                           f"{self._settings.max_schema_repairs} repairs",
                    started=started,
                    checklist=checklist,
                    validation=gate.as_dict(),
                )

            critique = await self._critique(state, checklist, submitted)
            if critique.malformed:
                return self._warn(
                    state,
                    submitted,
                    checklist=checklist,
                    started=started,
                    validation=gate.as_dict(),
                    warnings=["the completeness critique returned an unusable verdict; the deterministic "
                              "schema gate passed but completeness is unverified"],
                )
            if critique.satisfactory:
                return self._completed(state, submitted, checklist=checklist, started=started,
                                       validation=gate.as_dict(), critique=critique)

            state.feedback = (
                "The reviewer rejected this submission. Address specifically:\n"
                + critique.instructions
            )
            state.add(Message(role="tool", content=state.feedback, name="Info", status="error"))

    # ------------------------------------------------------------------ nodes

    async def _plan_action(self, state: ResearchState, checklist: list[str]) -> dict[str, Any]:
        action = await self._llm.generate_json(
            system="You are a research agent that emits one action at a time as JSON.",
            prompt=prompts.research_prompt(state, checklist),
            json_schema=prompts.ACTION_SCHEMA,
        )
        state.add(Message(role="assistant", content=str(action), name="plan_action"))
        return action

    async def _collect(self, state: ResearchState, action: dict[str, Any]):
        outcomes = await tools.execute_action(state, self._web, action)
        result = outcomes[0] if outcomes else None
        if result is None:
            return None
        state.add(Message(
            role="tool",
            content=result.content if result.ok else (result.error or "tool failed"),
            name=result.name,
            status="success" if result.ok else "error",
        ))
        return result

    async def _submit_extraction(self, state: ResearchState, checklist: list[str]) -> dict[str, Any]:
        return await self._llm.generate_json(
            system="Emit only the JSON object described by the schema. No prose.",
            prompt=prompts.submission_prompt(state, checklist),
            json_schema=state.extraction_schema,
        )

    async def _critique(self, state: ResearchState, checklist: list[str],
                        proposed: dict[str, Any]) -> _Critique:
        verdict = await self._llm.generate_json(
            system="You are a strict reviewer of extracted data. Answer in JSON only.",
            prompt=prompts.critique_prompt(state, checklist, proposed),
            json_schema=prompts.CRITIQUE_SCHEMA,
        )
        reasons = [str(item) for item in (verdict.get("reason") or []) if str(item).strip()]
        instructions = str(verdict.get("improvement_instructions", "")).strip()
        satisfactory = verdict.get("is_satisfactory")

        if not isinstance(satisfactory, bool) or len(reasons) < 3:
            return _Critique(satisfactory=None, reasons=reasons, instructions=instructions, malformed=True)
        if satisfactory is False and not instructions:
            # Their schema left improvement_instructions optional, so a rejection could
            # arrive with nothing actionable and the loop would spin on "Unsatisfactory
            # response: undefined". A rejection without instructions is a bad verdict.
            return _Critique(satisfactory=None, reasons=reasons, instructions=instructions, malformed=True)

        state.add(Message(
            role="tool",
            content=("\n".join(reasons) if satisfactory else f"Unsatisfactory: {instructions}"),
            name="Info",
            status="success" if satisfactory else "error",
        ))
        return _Critique(satisfactory=satisfactory, reasons=reasons, instructions=instructions)

    # -------------------------------------------------------------- reporting

    def _derive_records(self, submitted: dict[str, Any]) -> list[dict[str, Any]]:
        """The schema is caller-defined, so locate the entity array it describes.

        A schema declaring one array of objects (the usual shape for a collection of
        companies, channels or jobs) yields that list; anything else is treated as a
        single record. No field names are assumed.
        """
        array_keys = [
            key
            for key, sub in (submitted or {}).items()
            if isinstance(sub, list) and sub and all(isinstance(item, dict) for item in sub)
        ]
        if len(array_keys) == 1:
            return list(submitted[array_keys[0]])
        if array_keys:
            longest = max(array_keys, key=lambda key: len(submitted[key]))
            return list(submitted[longest])
        return [submitted]

    def _record_provenance(self, record: dict[str, Any], state: ResearchState) -> tuple[list[dict], list[str]]:
        """Attach observed sources to a record; flag URLs it mentions that we never fetched."""
        mentioned: list[str] = []
        for value in record.values():
            if isinstance(value, str):
                mentioned.extend(match.group(0) for match in _URL_IN_VALUE.finditer(value))

        supported = [state.sources[url].as_dict() for url in dict.fromkeys(mentioned) if url in state.sources]
        unverified = [url for url in dict.fromkeys(mentioned) if url not in state.sources]
        return supported, unverified

    def _metadata(self, state: ResearchState, checklist: list[str], started: float) -> dict[str, Any]:
        return {
            "model": state.limits.model_id or self._settings.llm_model_id,
            "loopsUsed": state.budget.loops_used,
            "maxLoops": state.budget.max_loops,
            "searchesUsed": state.budget.searches_used,
            "scrapesUsed": state.budget.scrapes_used,
            "toolErrors": len(state.tool_errors),
            "repairAttempts": state.repair_attempts,
            "sourceCount": len(state.sources),
            "schemaFieldCount": len(checklist),
            "durationMs": int((time.perf_counter() - started) * 1000),
        }

    def _validation(self, state: ResearchState, gate: dict[str, Any] | None, critique: _Critique | None,
                    warnings: list[str], unverified: list[str]) -> dict[str, Any]:
        validation = {
            "schemaValid": bool(gate.get("ok")) if gate else True,
            "missingFields": gate.get("missing", []) if gate else [],
            "extraFields": gate.get("extra", []) if gate else [],
            "repairsUsed": state.repair_attempts,
            "critiqueSatisfactory": critique.satisfactory if critique else None,
            "critiqueReasons": critique.reasons if critique else [],
            "unverifiedUrls": unverified,
            "warnings": warnings,
        }
        return validation

    def _completed(self, state: ResearchState, submitted: dict[str, Any], *, checklist: list[str],
                   started: float, validation: dict[str, Any], critique: _Critique) -> ResearchOutcome:
        records = self._derive_records(submitted)
        all_unverified: list[str] = []
        enriched: list[dict[str, Any]] = []
        for record in records:
            supported, unverified = self._record_provenance(record, state)
            all_unverified.extend(unverified)
            enriched.append({"values": record, "sources": supported})

        warnings: list[str] = []
        if state.limits.expected_records and len(records) < state.limits.expected_records:
            warnings.append(
                f"expected at least {state.limits.expected_records} records, collected {len(records)}"
            )
        if all_unverified:
            warnings.append("some cited URLs were never retrieved by a tool this run")
        if state.tool_errors:
            warnings.append(f"{len(state.tool_errors)} tool call(s) failed during collection")

        status = STATUS_COMPLETED_WITH_WARNINGS if warnings else STATUS_COMPLETED
        return ResearchOutcome(
            status=status,
            records=enriched,
            sources=[source.as_dict() for source in state.sources.values()],
            metadata=self._metadata(state, checklist, started),
            validation=self._validation(state, validation, critique, warnings, all_unverified),
        )

    def _warn(self, state: ResearchState, submitted: dict[str, Any], *, checklist: list[str],
              started: float, validation: dict[str, Any], warnings: list[str]) -> ResearchOutcome:
        partial = _Critique(satisfactory=None, reasons=[], instructions="")
        outcome = self._completed(state, submitted, checklist=checklist, started=started,
                                  validation=validation, critique=partial)
        merged = list(dict.fromkeys(warnings + outcome.validation.get("warnings", [])))
        outcome.validation["warnings"] = merged
        outcome.validation["critiqueSatisfactory"] = None
        outcome.status = STATUS_COMPLETED_WITH_WARNINGS
        return outcome

    def _fail(self, state: ResearchState, *, reason: str, started: float,
              checklist: list[str], validation: dict[str, Any] | None = None) -> ResearchOutcome:
        return ResearchOutcome(
            status=STATUS_FAILED,
            records=[],
            sources=[source.as_dict() for source in state.sources.values()],
            metadata=self._metadata(state, checklist, started),
            validation=self._validation(state, validation, None, [reason], []),
            failure_reason=reason,
        )
