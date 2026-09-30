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
from app.curation import queries, relevance
from app.curation.aggregation import aggregate_sources
from app.curation.policy import SourcePolicy
from app.curation.robots import RobotsGate
from app.extraction.schema_validate import field_checklist, validate_against_schema
from app.firecrawl.client import WebTool
from app.llm.client import LlmClient
from app.research import prompts, tools
from app.research.skills import SkillLibrary
from app.research.state import Message, ResearchLimits, ResearchState

STATUS_COMPLETED = "COMPLETED"
STATUS_COMPLETED_WITH_WARNINGS = "COMPLETED_WITH_WARNINGS"
STATUS_FAILED = "FAILED"

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

    def __init__(self, *, llm: LlmClient, web: WebTool, settings: Settings,
                 skills: SkillLibrary | None = None,
                 robots: RobotsGate | None = None) -> None:
        self._llm = llm
        self._web = web
        self._settings = settings
        # None means "no playbooks", which is the shipped default until this deployment
        # writes its own. It is not a fallback to a built-in set: there is none.
        self._skills = skills
        # One gate per run, so robots.txt is cached within a run but never goes stale across
        # runs — a file fetched for a long-lived process would otherwise outlive the site's edit.
        self._robots = robots

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
            max_interactions_per_run=self._settings.max_interactions_per_run,
            allowed_tools=list(self._settings.allowed_web_tools),
            max_sources_per_domain=self._settings.max_sources_per_domain,
            min_relevance_score=self._settings.min_relevance_score,
            max_candidates_per_search=self._settings.max_candidates_per_search,
            model_id=self._settings.llm_model_id,
        )
        state = ResearchState(topic=topic, extraction_schema=extraction_schema, limits=resolved)
        checklist = field_checklist(extraction_schema)
        # Requirement → search strategy → relevant sources → source policy → Firecrawl.
        strategy = queries.build_strategy(queries=(seed_queries or []),
                                         max_queries=resolved.max_searches_per_run,
                                         desired_sources=resolved.desired_sources)
        policy = SourcePolicy(allowed_domains=resolved.allowed_domains,
                              blocked_domains=resolved.blocked_domains,
                              robots=self._robots)
        target = relevance.target_from(topic=topic, entity_type=resolved.entity_type,
                                       extraction_schema=extraction_schema,
                                       preferred_domains=resolved.preferred_domains,
                                       blocked_domains=resolved.blocked_domains)
        # A tool the ceiling removed is not offered to the model at all, so an attempt to
        # use it is a contract violation rather than a plausible-looking turn.
        enabled_tools = [tool for tool in prompts.DATA_ACTIONS if tool in set(resolved.allowed_tools)]
        valid_actions = (*enabled_tools, *prompts.CONTROL_ACTIONS)
        started = time.perf_counter()

        for query in strategy.queries:
            await self._collect(state, {"action": "search", "query": query}, policy=policy, target=target)
        state.search_strategy = {
            "queries": list(strategy.queries),
            "requestedQueries": list(seed_queries or []),
            "droppedQueries": queries.dropped_count(requested=list(seed_queries or []),
                                                    strategy=strategy),
        }

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
            action = await self._plan_action(state, checklist, self._playbooks_for(state))
            kind = str(action.get("action", "")).strip().lower()

            if kind not in valid_actions:
                state.feedback = f"'{kind}' is not one of {', '.join(valid_actions)}. Choose one and act."
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

            if kind in enabled_tools:
                outcome = await self._collect(state, action, policy=policy, target=target)
                if outcome is not None and not outcome.ok:
                    state.tool_errors.append(outcome.error or "tool failed")
                continue

            # kind == "submit"
            if not state.has_tool_data():
                # Gate 2, ported from `agent.ts:37-40,42-66`: no answer before data.
                state.feedback = (
                    "Nothing has been retrieved yet this run. Call "
                    f"{' or '.join(enabled_tools)} before submitting; a result built from prior "
                    "knowledge is not acceptable."
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

    def _playbooks_for(self, state: ResearchState) -> list[tuple[str, str]]:
        """Site guidance for domains this run has actually touched.

        Sorted by URL so two identical runs get the same prompt text; a set iteration order
        that varies between turns would make the graph unreproducible.
        """
        if self._skills is None:
            return []
        found = self._skills.playbook_bodies_for(sorted(state.observed_urls()))
        for name, _ in found:
            if name not in state.playbooks_used:
                state.playbooks_used.append(name)
        return found

    async def _plan_action(self, state: ResearchState, checklist: list[str],
                           playbooks: list[tuple[str, str]] | None = None) -> dict[str, Any]:
        state.note_turn("plan_action")
        action = await self._llm.generate_json(
            system="You are a research agent that emits one action at a time as JSON.",
            prompt=prompts.research_prompt(state, checklist, playbooks),
            json_schema=prompts.action_schema(state.limits.allowed_tools),
        )
        state.add(Message(role="assistant", content=str(action), name="plan_action"))
        return action

    async def _collect(self, state: ResearchState, action: dict[str, Any], *,
                       policy: SourcePolicy, target: relevance.RelevanceTarget):
        outcomes = await tools.execute_action(state, self._web, action,
                                             policy=policy, target=target)
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
        state.note_turn("submit_extraction")
        return await self._llm.generate_json(
            system="Emit only the JSON object described by the schema. No prose.",
            prompt=prompts.submission_prompt(state, checklist),
            json_schema=state.extraction_schema,
        )

    async def _critique(self, state: ResearchState, checklist: list[str],
                        proposed: dict[str, Any]) -> _Critique:
        state.note_turn("critique")
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

    @staticmethod
    def _mentioned_urls(record: dict[str, Any]) -> list[str]:
        mentioned: list[str] = []
        for value in record.values():
            if isinstance(value, str):
                mentioned.extend(match.group(0) for match in _URL_IN_VALUE.finditer(value))
        return list(dict.fromkeys(mentioned))

    def _metadata(self, state: ResearchState, checklist: list[str], started: float) -> dict[str, Any]:
        return {
            "model": state.limits.model_id or self._settings.llm_model_id,
            "loopsUsed": state.budget.loops_used,
            "maxLoops": state.budget.max_loops,
            "searchesUsed": state.budget.searches_used,
            "scrapesUsed": state.budget.scrapes_used,
            "interactionsUsed": state.budget.interactions_used,
            "interactions": [item.as_dict() for item in state.interactions],
            "interactionsUnverified": len(state.unverified_interactions()),
            # Where the model turns went. The loop bound says how far a run was allowed to go; this
            # says what each turn was for, which is the question a slow or costly run actually asks.
            "turnsByNode": dict(state.turns),
            "enabledTools": [tool for tool in prompts.DATA_ACTIONS if tool in set(state.limits.allowed_tools)],
            "playbooksUsed": list(state.playbooks_used),
            "toolErrors": len(state.tool_errors),
            "repairAttempts": state.repair_attempts,
            "sourceCount": len(state.sources),
            "schemaFieldCount": len(checklist),
            # Curation accounting: what the search strategy planned, what was dropped before it
            # became a candidate, what a policy refused, and how many extra provider attempts
            # the retry layer spent. Without these a run that filtered 40 results down to 3 and
            # a run that found 3 look identical from the outside.
            "searchStrategy": state.search_strategy,
            "candidatesDropped": len(state.dropped_candidates),
            "duplicateSourcesCollapsed": state.duplicates_collapsed,
            "sourcesRefused": len(state.refusals),
            "retriesAttempted": getattr(self._web, "retry_attempts", 0),
            "durationMs": int((time.perf_counter() - started) * 1000),
        }

    def _validation(self, state: ResearchState, gate: dict[str, Any] | None, critique: _Critique | None,
                    warnings: list[str], aggregation) -> dict[str, Any]:
        validation = {
            "schemaValid": bool(gate.get("ok")) if gate else True,
            "missingFields": gate.get("missing", []) if gate else [],
            "extraFields": gate.get("extra", []) if gate else [],
            "repairsUsed": state.repair_attempts,
            "critiqueSatisfactory": critique.satisfactory if critique else None,
            "critiqueReasons": critique.reasons if critique else [],
            "unverifiedUrls": list(aggregation.unverified_urls) if aggregation else [],
            "recordsWithoutEvidence": (list(aggregation.record_indices_without_evidence)
                                       if aggregation else []),
            "duplicateSourcesCollapsed": aggregation.duplicates_collapsed if aggregation else 0,
            "refusedSources": [dict(refusal) for refusal in state.refusals],
            "droppedCandidates": list(state.dropped_candidates[-20:]),
            "warnings": warnings,
        }
        return validation

    def _completed(self, state: ResearchState, submitted: dict[str, Any], *, checklist: list[str],
                   started: float, validation: dict[str, Any], critique: _Critique) -> ResearchOutcome:
        records = self._derive_records(submitted)
        enriched: list[dict[str, Any]] = []
        citations: list[list[str]] = []
        mentioned: list[list[str]] = []
        for record in records:
            urls = self._mentioned_urls(record)
            observed = [url for url in urls if url in state.sources]
            citations.append(observed)
            mentioned.append(urls)
            enriched.append({
                "values": record,
                "sources": [state.sources[url].as_dict() for url in observed],
            })

        aggregation = aggregate_sources(
            state.sources,
            citations_by_record=citations,
            mentioned_by_record=mentioned,
            duplicates_collapsed=state.duplicates_collapsed,
        )

        warnings: list[str] = []
        if state.limits.expected_records and len(records) < state.limits.expected_records:
            warnings.append(
                f"expected at least {state.limits.expected_records} records, collected {len(records)}"
            )
        if aggregation.unverified_urls:
            warnings.append("some cited URLs were never retrieved by a tool this run")
        if aggregation.record_indices_without_evidence:
            warnings.append(
                f"{len(aggregation.record_indices_without_evidence)} record(s) cite no source this "
                "run retrieved — they are returned, not dropped, and are not evidence-backed"
            )
        if state.tool_errors:
            warnings.append(f"{len(state.tool_errors)} tool call(s) failed during collection")
        if state.refusals:
            warnings.append(
                f"{len(state.refusals)} source(s) were refused before fetching "
                f"({', '.join(sorted({refusal['code'] for refusal in state.refusals}))})"
            )
        unverified = state.unverified_interactions()
        if unverified:
            # A browser session that answered is not a page that changed. If the run acted and cannot
            # show the effect, the records it built may rest on a filter that was never applied — so
            # the answer is returned and the doubt travels with it, in both directions.
            warnings.append(
                f"{len(unverified)} browser session(s) did not visibly change the page "
                f"({', '.join(f'{item.url}: {item.verdict}' for item in unverified[:3])}); values "
                "reached only through those sessions are not verified"
            )

        status = STATUS_COMPLETED_WITH_WARNINGS if warnings else STATUS_COMPLETED
        return ResearchOutcome(
            status=status,
            records=enriched,
            sources=aggregation.sources,
            metadata=self._metadata(state, checklist, started),
            validation=self._validation(state, validation, critique, warnings, aggregation),
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
            validation=self._validation(state, validation, None, [reason], None),
            failure_reason=reason,
        )
