# A. Final Architecture

## A.1 The decisive question: where does the agent live?

Your brief left this open and required Phase 0 to answer it. Evidence:

| Fact | Source |
|---|---|
| The TypeScript core is 5,035 LOC across ~19 modules (agent, toolkit, tools, firecrawl-tools, orchestrator + sub-agents + compaction, skills ×4, resolve-model, schema-validate, stream-helpers, tool-results, worker) | `web-agent-main/agent-core/src/**` |
| A Python port exists but is **352 LOC of source** in 4 files, with 3 tools (`search`, `scrape`, `format_output`) | `web-agent-main/.internal/agent-core-py/src/firecrawl_agent/` |
| The Python port has **no `interact`**, no skills, no subagents, no compaction, no schema validation; `RunResult.steps` is hardcoded `[]`; `max_steps` is accepted but never passed to PydanticAI | `agent.py:104-120,169-170`, `types.py:33,45` |
| **But** the Firecrawl *Python SDK* natively exposes every primitive we need | PyPI `firecrawl` 4.45.0; official Python SDK docs list `scrape`, `crawl`, `map`, `search`, `parse`, `agent`, `browser`, `interact`, `stop_interaction` |
| The TS core itself does not implement web tools — it obtains them from `firecrawl-aisdk` (a TS-only npm package, pinned to `0.12.0-beta.2`) | `agent-core/src/firecrawl-tools.ts:1,14`, `package.json` deps |
| `@firecrawl/agent-core` is not on npm (404) and has no git metadata locally | `UPSTREAM.md:11-13`, verified registry lookup |

**Conclusion: the agent core's *value* is its policy gates and prompts, not its plumbing.**
The plumbing is `firecrawl-aisdk`, which has a Python equivalent that already supports
`interact`. Therefore Python can host the web-agent layer directly.

### Decision

**Three runtimes. No Node backend. No fourth runtime.**

```
Next.js (frontend, client only)
      │  REST + SSE
      ▼
Spring Boot (Java 21)  ── orchestrator, system of record, governance, API, SSE, export
      │  internal REST (localhost / service network)
      ▼
FastAPI (Python 3.12)  ── stateless AI + collection functions
      │
      ├── Google Gemini (structured output: requirement, plan, extraction)
      └── Firecrawl Python SDK (search / scrape / interact)
      ▼
   MySQL 8+  ── the ONLY state store. No Redis, no BullMQ, no Celery.
```

We do **not** vendor the TS `agent-core`, and we do **not** run the Express template. We port
the two things from it that matter (see `I-firecrawl-integration.md`): the schema-validation
gate with bounded repair, and the "no final answer until a data tool returned non-empty
results" gate.

### Why not an autonomous agent loop?

The TS core's autonomy (deepagents plan/act/observe, subagents, parallel workers, compaction)
exists because *it* owns orchestration. In FINALAIAGENT, **Spring owns orchestration** — the
LLM produces a validated plan, and Spring executes that plan as a persisted job DAG. Making
Python also run an autonomous loop would create two competing orchestrators and two sources of
truth for step state, which is precisely the class of bug the old project had.

So: the LLM decides *what* to do (requirement → plan); Spring decides *when and whether* it
runs (job engine, governance, retries, cancellation); Python decides *how* each step extracts
data (Firecrawl calls + schema-validated structured output).

This also satisfies the non-negotiable requirement that natural language actually drives the
system: the prompt determines objective, entity, fields, filters, source strategy and the step
sequence — all validated before execution — with no keyword matching and no fallback templates
anywhere in the path.

---

## A.2 Responsibility split

### Spring Boot (Java 21) — stateful orchestrator and system of record

- Public REST API (`/api/v1/**`) — the only surface the frontend may call
- Authentication & authorization (JWT, mandatory on every business route), workspace tenancy
- Requirement intake; calls Python to parse; **validates the returned contract** and rejects
  invalid output (fail closed, never substitute a default)
- Workflow planning; calls Python to plan; validates the DAG against the fixed step vocabulary
  and cross-checks it against the requirement's fields
- **Job engine**: MySQL-backed `workflow_jobs` + `workflow_steps`, claim via
  `FOR UPDATE SKIP LOCKED`, lease/heartbeat, stale recovery, bounded thread pool, retries with
  persisted backoff, cooperative cancellation, graceful shutdown
- **Source governance (authoritative)**: URL validation + SSRF guard, allow/block domain rules,
  robots.txt fetch/parse/cache with fail-closed policy, per-domain rate limiting, source
  lifecycle persistence, relevance ranking of search candidates
- Dataset persistence and querying: dynamic columns, rows, pagination, filter, sort, search
- Provenance/evidence storage and the evidence-integrity rules
- Activity event log (durable, replayable) and **SSE** run monitoring
- Export job engine (queued, not in-process) with CSV/JSON/XLSX writers and checksums
- DTO mapping — **no fabricated defaults**; absent data is returned as absent

### FastAPI (Python 3.12) — stateless AI and collection functions

Five endpoints, all stateless, all called by Spring:

| Endpoint | Purpose |
|---|---|
| `POST /ai/v1/requirements/parse` | prompt → structured Requirement (Gemini structured output) |
| `POST /ai/v1/workflows/plan` | requirement → workflow plan DAG |
| `POST /ai/v1/collect/search` | plan queries → candidate URLs (Firecrawl search) |
| `POST /ai/v1/collect/extract` | cleared URLs + extraction schema → records + per-record source URLs |
| `POST /ai/v1/quality/process` | raw records → normalized, validated, deduplicated, resolved, scored |

Python holds **no state**. No database access, no job table, no session store. Every response
is a pure function of the request. This is what makes the no-Redis constraint safe: there is
nothing in Python to lose on restart.

The data-intelligence pipeline lives here (it is text-heavy, heuristic, and the records are
already in-process after extraction), but its output is **advisory**. Spring re-enforces the
contract before persisting: required fields present, types correct, and — critically — every
row has at least one evidence link. Python proposes, Java disposes.

### Next.js — client only

Renders data, collects input, streams SSE. Contains no requirement parsing, no workflow
generation, no validation, no deduplication, no source decisions, and no fabricated fallback
values.

---

## A.3 End-to-end request flow

```
1. User types a prompt                                    [Next.js]
2. POST /api/v1/requirements/parse                        [Spring]
     └─► POST /ai/v1/requirements/parse                   [Python → Gemini]
     └─ Spring validates the contract; 422 + clarifying
        questions if invalid or ambiguous. NEVER defaults.
3. POST /api/v1/workflows/plan                            [Spring]
     └─► POST /ai/v1/workflows/plan                       [Python → Gemini]
     └─ Spring validates step vocabulary, dependency order,
        retry/timeout bounds, ≥1 EXTRACT and ≥1 SAVE,
        plan-vs-requirement field agreement
     └─ Persists WorkflowPlan (versioned, immutable)
     └─ 2-attempt correction loop on validation failure
4. POST /api/v1/workflows/execute → 202 {runId}           [Spring]
     └─ Inserts workflow_run + workflow_jobs rows (PENDING)
     └─ Returns immediately. No synchronous long work.
5. Job worker claims a job (FOR UPDATE SKIP LOCKED)       [Spring]
     For each step in dependency order:
       SEARCH   → Python /collect/search → candidates
                  → Spring governance: SSRF, allow/block,
                    robots (fail closed), relevance rank
                  → Source rows persisted with lifecycle
       SCRAPE / INTERACT / EXTRACT
                → Spring batch-clears URLs → Python
                  /collect/extract with the plan's schema
                  → schema-validation gate + bounded repair
                  → records + sourceUrls
                  → Spring keeps ONLY tool-observed URLs as
                    evidence; model-claimed URLs are marked
                    unverified
       TRANSFORM / VALIDATE / DEDUPLICATE / MERGE
                → Python /quality/process
                  → Spring re-enforces the contract
       VERIFY   → optional critique step (see F)
       SAVE     → transactional persist: dataset, columns,
                  rows, evidence, validation issues,
                  dedup events, quality report
       EXPORT   → queued export job (real, not SKIPPED)
     Every transition writes activity_events + workflow_steps
6. GET /api/v1/runs/{id}/events (SSE)                     [Spring]
     └─ Replays history from activity_events (Last-Event-ID),
        then streams live from an in-process emitter registry
7. GET /api/v1/datasets/{id}/rows, /sources, /evidence    [Spring]
8. POST /api/v1/datasets/{id}/exports → download          [Spring]
```

---

## A.4 Deployment topology

**v1 target: single node, three processes + MySQL.** This is not a shortcut — it is forced by
two no-Redis consequences:

1. SSE fan-out. Without Redis pub/sub, a live event emitted by the worker reaches a browser
   only if the emitter registry is in the same JVM. Single-node makes the in-process
   `ApplicationEventPublisher` + `SseEmitter` registry correct.
2. Rate limiting and per-domain request accounting are in-memory (Bucket4j). Multi-node would
   let each node spend its own budget, silently multiplying the real request rate against a
   source — a governance violation, not just an inaccuracy.

Consequences to design for now, not later:
- The job claim query is still written with `FOR UPDATE SKIP LOCKED` so horizontal scale-out
  needs no schema change — only the SSE and rate-limit layers would need replacing.
- `activity_events` remains the durable truth, so an SSE reconnect after a restart replays
  correctly regardless of topology.
- Document explicitly: **scaling beyond one node requires replacing in-process SSE fan-out and
  in-memory rate limiting.** Do not silently scale out.

Containers: Docker is **not installed** on this machine, so local development runs MySQL as the
existing native `MySQL96` service and the three processes directly. A `docker-compose.yml` is
still delivered for deployment, but with these corrections to the old one: drop the `redis`
service, put the backend on a single documented port, set `FRONTEND_ORIGIN` to the actual
Next.js origin, and remove the insecure default JWT secrets (fail startup instead).

---

## A.5 What is deliberately NOT in this architecture

| Excluded | Reason |
|---|---|
| Redis / BullMQ / Celery / Redis Streams / pub-sub | Brief constraint. Replaced per `J-no-redis-job-architecture.md` |
| A Node/Express backend runtime | Firecrawl's Python SDK covers search/scrape/interact, so no fourth runtime is justified |
| Vendoring `@firecrawl/agent-core` (TS) | 5,035 LOC of LangChain/deepagents machinery we would not use; Spring owns orchestration |
| Autonomous Python agent loop | Two orchestrators = two sources of truth for step state |
| `DEMO_MODE` or any silent simulation fallback | Root cause of the old project's core defect. Tests use mocks; production fails closed |
| Anakin or TheAgenticBrowser code | AGPL-3.0 / Community License. Patterns only |
| Client-side business logic | Frontend is a client |
| Postgres | Brief specifies MySQL |

Next: `B-technology-stack.md`.
