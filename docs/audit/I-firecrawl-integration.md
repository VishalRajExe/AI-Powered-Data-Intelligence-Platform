# I. Firecrawl Integration Design

**This is the explicit Phase 0 architecture decision the brief required.**

---

## I.1 The question

The brief listed two candidate topologies and forbade a fourth runtime unless direct Agent Core
reuse requires it:

```
Option 1:  Next.js → Spring Boot → Python AI service → Firecrawl Agent service/API → Web
Option 2:  Spring Boot → small internal TypeScript Firecrawl Agent runtime → Firecrawl Agent Core
```

It also warned: *do not falsely claim Python can import a TypeScript npm package.* That warning
is correct and is respected here — nothing in this design has Python importing an npm package.

## I.2 Evidence gathered

| # | Finding | Evidence |
|---|---|---|
| 1 | The TS core is **5,035 LOC** across ~19 modules: `agent.ts` (675), `toolkit.ts` (206), `tools.ts` (266), `tool-results.ts` (607), `schema-validate.ts` (169), `orchestrator/` (+`sub-agents.ts`, `compaction.ts`), `skills/` ×4, `worker/` ×2, `resolve-model.ts`, `stream-helpers.ts`, `adapter.ts` | `web-agent-main/agent-core/src/**` |
| 2 | A Python port exists but is **352 LOC of source** in 4 files, with 3 tools (`search`, `scrape`, `format_output`) | `.internal/agent-core-py/src/firecrawl_agent/{agent,types,prompts,__init__}.py` |
| 3 | The Python port has **no `interact`**, no skills, no subagents, no compaction, no worker, no schema validation. `RunResult.steps` is hardcoded `[]` (`agent.py:110,118-119`). `max_steps` is declared (`types.py:33,45`) but **never passed** to PydanticAI (`agent.py:46-51,113-120`) → unbounded runs | direct read |
| 4 | The Python port calls the **synchronous** Firecrawl SDK inside `async def` tools → blocks the event loop | `agent.py:61,81` |
| 5 | **The TS core does not implement web tools itself.** It obtains them from `firecrawl-aisdk` (TS-only npm, pinned `0.12.0-beta.2`), via `FirecrawlTools({apiKey, …})` | `agent-core/src/firecrawl-tools.ts:1,14`; `toolkit.ts:1,148-152`; `package.json` deps |
| 6 | **The Firecrawl Python SDK natively exposes every primitive we need**: `scrape`, `crawl`, `map`, `search`, `parse`, `agent`, `browser`, `interact`, `stop_interaction` | PyPI `firecrawl` 4.45.0 (verified available); official Python SDK docs |
| 7 | The TS core ships **no HTTP server**. `openapi.yaml` is a contract that *host templates* implement; the Express template (~227 lines) is the reference server | `agent-core/openapi.yaml`; `agent-templates/express/server.ts` |
| 8 | `@firecrawl/agent-core` is **not published to npm** (registry 404, verified) and the local snapshot has no git metadata → vendoring only, no upstream diff possible | `UPSTREAM.md:11-13` |
| 9 | The core has **no persistence of any kind**: run state is a LangChain message list, worker progress is an in-memory `globalThis` Map, the bash FS is in-memory WASM. The Next template's `_lib/db.ts` is an explicit stub ("Conversation history is not used") | `agent.ts:177`; `worker/index.ts:23-27`; `tools.ts:43-51` |
| 10 | License is **MIT** (`package.json:118`; vendored `LICENSE` "Copyright (c) 2026 Firecrawl"). Note upstream `agent-core/` has **no LICENSE file** — the MIT declaration is in `package.json` metadata only | verified |
| 11 | The old project's vendored copy differs from upstream in **exactly one file**: `src/types.ts`, a 2-line `apiUrl?: string` addition enabling a self-hosted Firecrawl base URL, actually used at `FirecrawlAgentAdapter.ts:73` | `diff -rq` of both `src/` trees |

## I.3 Decision

**Option 3 (chosen): Next.js → Spring Boot → FastAPI (Python) → Firecrawl Python SDK → Web.**

Neither of the brief's two options, and better than both:

- **Not Option 1** — there is no separate "Firecrawl Agent service" to deploy. The agent *core*
  is a harness around the SDK; the SDK is the thing that talks to the web. Since Python can call
  the SDK directly (finding 6), a separate agent service would be a pass-through process.
- **Not Option 2** — a TypeScript runtime would be the **fourth runtime** the brief forbids, and
  it would be needed only to reach `firecrawl-aisdk`, which has a Python equivalent exposing the
  same operations. Vendoring 5,035 LOC of LangChain/deepagents machinery to get there is not
  justified.

Three runtimes total: **Next.js, Spring Boot, FastAPI.**

### What we take from `web-agent-main`

Not the harness — the **policy and the prompts**, which is where the real value is:

| Taken | Method |
|---|---|
| `schema-validate.ts` (169 LOC, pure logic) — one validator used for prompting, runtime gating and post-run assessment | **PORT** to Python |
| The two enforcement gates: `MAX_SCHEMA_REPAIRS = 3`, and "no final answer until a data tool returned non-empty data" | **PORT** |
| `orchestrator/prompts/system.md` tool policy (incl. "do not retry 404 / bot-check URLs"), `<required_schema>` + `<field_checklist>` rendering | **DIRECT COPY** (MIT; retain license notice) |
| `toolkit.ts` discipline: one module owns the SDK; `interact` gets a hard 60s timeout + null-field stripping; tools filtered by an enabled list | **PORT** (pattern) |
| `tool-results.ts` payload normalization | **PORT SELECTIVELY** — only shapes we persist or render |
| `orchestrator/compaction.ts` (75% threshold, 8-section summary, best-effort) | **PORT (deferred)** — only if extraction context grows large |
| `skills/` loader + `structured-extraction` SKILL.md | **PORT loader / DIRECT COPY content (deferred)** — not on the v1 critical path |
| `createAgentFromEnv` failing loudly when `FIRECRAWL_API_KEY` is absent | **PORT** (behaviour) — precisely what the old project got wrong |
| `.internal/agent-core-py` | **ADAPT as reference code**, not a dependency (it lives in `.internal`, unpublished and unversioned). Fixes required before any reuse: wire step limits, populate `steps`, make SDK calls non-blocking, add schema validation, unify event field naming |
| `agent-templates/express/server.ts` + `Dockerfile` | **RETAIN AS DOCUMENTED FALLBACK** (I.6) |

### What we deliberately do not take

LangChain, `deepagents`, `firecrawl-aisdk`, the `ai` SDK, `just-bash` WASM sandbox, subagent
spawning, parallel worker pools, `exportSkill`, `resolveModel`'s five-provider switch.

Justification for dropping subagents/workers specifically: the TS core needs them because *it*
owns orchestration and fan-out. In FINALAIAGENT, **Spring owns fan-out** — `workflow_jobs` with
`parent_job_id` models per-source parallelism with persistence, leases and recovery, which the
core's in-memory `globalThis` progress Map cannot (finding 9). Adopting both would mean two
fan-out mechanisms and two places where step state lives.

Two constraints worth carrying over as facts, since they were learned the hard way upstream:
**no `interact` in parallel fan-out** (browser sessions are too heavy — `worker/index.ts:61-64`),
and **a hard per-task timeout** (upstream uses 5 minutes).

## I.4 Integration design

```
Spring Boot (WorkflowExecutor)
   │
   │  1. SEARCH step
   ├─► POST /ai/v1/collect/search {queries, limit, blockedDomains, preferredDomains}
   │      └─ firecrawl.search()  → raw candidates
   │
   │  2. GOVERNANCE (Java, authoritative — cannot be bypassed)
   │      SSRF guard → allow/block domains → robots.txt (fail closed)
   │      → relevance rank → per-domain rate budget → persist `sources` lifecycle
   │
   │  3. SCRAPE / INTERACT / EXTRACT step, with cleared URLs only
   ├─► POST /ai/v1/collect/extract {targets, extractionSchema, allowedTools, …}
   │      ├─ firecrawl.scrape() / firecrawl.interact()   [async, semaphored]
   │      ├─ Gemini structured output against extractionSchema
   │      ├─ schema-validation gate + ≤3 repairs
   │      └─ returns records, sources, observedSourceUrls, schemaMismatch, execution
   │
   │  4. EVIDENCE RULE (Java)
   │      keep only tool-observed URLs; model-claimed URLs → verified_by_tool=false;
   │      records with no observed source → SOURCE_EVIDENCE_UNVERIFIED
   │
   │  5. TRANSFORM / VALIDATE / DEDUPLICATE / MERGE
   ├─► POST /ai/v1/quality/process → advisory result
   │      └─ Java re-enforces required fields, types, evidence presence
   │
   │  6. VERIFY (optional, planner-decided)
   ├─► POST /ai/v1/verify → {feedback, terminate, decision}
   │
   │  7. SAVE (Java, transactional) / EXPORT (queued job)
```

**The governance gate moved outward.** In the old project it was a wrapper *inside* the agent
adapter (`FirecrawlAgentAdapter.ts:242-309`) — the agent could, in principle, be constructed
without it. Here, Python receives **only URLs Java has already cleared**, and Java decides what
counts as evidence on the way back. The agent has no path around the policy. That is a
structurally stronger position than the original, and it is why governance stays in Java even
though collection happens in Python.

**Internal transport.** Plain HTTP over localhost / the private network with a shared
`X-API-Key` compared in constant time. No service mesh, no message broker. Timeouts and retries
on the Spring side via Resilience4j, with per-endpoint budgets (search 30s, extract 120-300s).

**Streaming.** Not needed between Spring and Python for v1: a collection step is one
request/response, and the *user-facing* liveness comes from `activity_events` + SSE, which Java
emits as steps transition. This removes the three-way event-name drift found upstream
(`tool_name` in Python vs `toolName` in TS vs `name` in `openapi.yaml`). If per-tool liveness is
later wanted, add a chunked/NDJSON response from `/collect/extract` and map it to activity
events in Java — still one vocabulary, defined once in Java.

## I.5 Cost and quota controls

Every default Firecrawl operation burns cloud credits, and `interact` spins a full browser
session. Controls, all enforced in Java:

1. **Source caps from the plan** (`searchStrategy.desiredSourceCount` / `maximumSourceCount`),
   with the search limit `min(20, maximumSourceCount)` as the old adapter did.
2. **Per-domain rate budget** (`maxRequestsPerDomainPerMinute ≤ 60`, plus robots `crawl-delay`
   as a floor).
3. **Governance rejects before spend** — a blocked domain, a robots disallow, or an SSRF hit
   costs zero credits because the URL never reaches Python.
4. **`interact` is opt-in per plan step**, 60s-capped, and never fanned out in parallel.
5. **Step budgets** (`maxSteps`-equivalent) persisted per step so a runaway extraction cannot
   loop. Upstream's own Python port lacks this (finding 3) — we wire it.
6. **Token accounting persisted** from `execution.tokens` per step, so a run's cost is
   auditable after the fact.
7. **Self-hosted Firecrawl option**: keep the vendored `apiUrl` idea (finding 11) as a
   `FIRECRAWL_BASE_URL` setting on the Python SDK client, so credits can be avoided entirely by
   pointing at a self-hosted instance.

## I.6 Fallback if the Python route proves insufficient

**Trigger conditions (any one):**
- The Python SDK's `interact` cannot do what a plan needs (session semantics, action set).
- Gemini structured output proves too unreliable for `extractionSchema` conformance at the
  required volume, and the TS core's schema-adherence machinery becomes necessary.
- We decide we genuinely need autonomous multi-step agent behaviour (skills, subagents,
  compaction) rather than plan-driven steps.

**Fallback:** run `agent-templates/express/server.ts` as a **sidecar** implementing
`agent-core/openapi.yaml` (`POST /run`, `GET /skills`, `GET /workers/progress`), vendoring
`agent-core` and re-applying the single 2-line `apiUrl` patch. Spring calls `POST /run` instead
of `/ai/v1/collect/extract`. That is a **fourth runtime**, so it requires an explicit recorded
decision in `Memory.md` — and the brief's constraint means we do not add it preemptively.

To keep that fallback cheap, `/ai/v1/collect/extract` is shaped so a sidecar could satisfy the
same contract: request carries targets + schema + tool allowlist; response carries records +
sources + execution metadata. **The wire contract is the stable thing; the implementation behind
it is swappable.**

### I.6.1 Phase 4 status against those triggers (2026-09-29)

Phase 4 implemented the Python route, so two of the three triggers can now be answered with
evidence rather than expectation:

| Trigger | Where it stands |
|---|---|
| `interact` session semantics or action set insufficient | **Not triggered, on shape grounds; unresolved on behaviour.** `firecrawl` 4.45.0 exposes `browser()`, `interact(job_id, code=None, *, prompt=None, language='node', timeout=None, origin=None)`, `stop_interaction(job_id)` and `stop_interactive_browser(job_id)` (deprecated alias) — all coroutines on `AsyncFirecrawlApp`. The `job_id`-first shape is handled by owning the session lifecycle inside the tool call. **Never yet called against the live API**: `FIRECRAWL_API_KEY` has length 0 in both the shell and the root `.env`, so `tests/test_live_firecrawl.py` skips. Latency, credit cost, prompt-mode answer quality and whether a session completes inside a 60 s deadline are all still unmeasured, so **G2 stays open** |
| Gemini structured output too unreliable for `extractionSchema` conformance | Not reached. `to_gemini_schema()` plus bounded repair is in place and tested offline; the live question is blocked by the 20 requests/day free-tier ceiling (see `Memory.md` §5) |
| Genuine need for autonomous multi-step behaviour (skills, subagents, compaction) | **Not triggered by Phase 4.** Skills became a deterministic playbook lookup over URLs the run already observed (`app/research/skills.py`); subagents and compaction stay out because Spring owns orchestration. If a future phase needs a *real* fan-out of autonomous workers, that is the trigger this section describes, and it would need its own recorded decision |

Nothing was added to `deploy/` for a sidecar, and no npm dependency was introduced. The fallback
remains a documented option, not a partial implementation.

## I.7 Provenance obligations

MIT permits all of the above, with conditions we will honour:

- Keep the Firecrawl MIT copyright notice for every copied prompt or SKILL.md file.
- Maintain `docs/control/THIRD-PARTY.md` recording, per borrowed item: source repo, source
  path, version, import date, license, and any local delta — the discipline the old project's
  `UPSTREAM.md` started but could not complete (no upstream commit was recorded because the
  snapshot had no git metadata).
- Record the license caveat: upstream `agent-core/` declares MIT in `package.json` but ships no
  LICENSE file. If we ever redistribute, confirm the license with upstream.
- Do **not** vendor `firecrawl-aisdk@0.12.0-beta.2` — a beta pin in a reference stack is not
  something to inherit.

Next: `J-no-redis-job-architecture.md`.
