# Memory.md — Living Project Memory

### Project: FINALAIAGENT — AI-Powered Data Intelligence Platform

This file records **verified** state only. Every "works" claim must name the test or command that
proved it. Anything skipped, unverified or assumed is recorded in §5, not omitted. This discipline
exists because the previous project's memory file claimed authorization was active, that no `.env`
existed, and that the system was production-ready — each contradicted by its own source
(see `docs/audit/00-FORENSIC-AUDIT.md` §2, §3).

---

## 1. Current Status

- **Current Phase:** 0 — Forensic audit. **COMPLETE.**
- **Last updated:** 2026-09-28
- **Application code written:** **none.** Phase 0 produced documentation only, as instructed.
- **Runnable:** no — there is nothing to run yet.
- **Blocked on:** decisions **G1** and **G2** (see §6), plus installing Python 3.12.

## 2. Completed Phases

- [x] **Phase 0 — Forensic audit.** Full source inspection of the old project (backend,
      PirateAgentUI, control docs) and all four reference repositories. Produced
      `docs/audit/00-FORENSIC-AUDIT.md` plus deliverables A-M. No code created.

## 3. Key Architectural Decisions Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-09-28 | **Three runtimes: Next.js + Spring Boot + FastAPI. No Node backend.** | The Firecrawl Python SDK (PyPI `firecrawl` 4.45.0) natively exposes `search`, `scrape`, `interact`, `browser`, `stop_interaction`, `map`, `crawl`, `parse`. The TS agent core does not implement web tools itself — it obtains them from `firecrawl-aisdk` (`agent-core/src/firecrawl-tools.ts:1,14`). So a Node runtime would exist only to reach an npm package whose Python equivalent already covers our needs. Details: `docs/audit/I-firecrawl-integration.md` |
| 2026-09-28 | **Do not vendor `@firecrawl/agent-core` (5,035 LOC).** Port only `schema-validate.ts` (~170 LOC), the two enforcement gates, and the prompt policy. | The core's autonomy (deepagents, subagents, workers, compaction) exists because *it* owns orchestration. Spring owns orchestration here, so importing it would create two orchestrators and two sources of truth for step state. The two gates are the actual anti-fabrication machinery and are absent from `agent-core-py` |
| 2026-09-28 | **`.internal/agent-core-py` is reference code, not a dependency.** | 352 LOC vs 5,035 LOC. No `interact`, no schema validation, `RunResult.steps` hardcoded `[]` (`agent.py:110,118`), `max_steps` accepted but never wired to PydanticAI (`types.py:33,45` vs `agent.py:46-51`), and it calls the sync SDK inside `async def` (`agent.py:61,81`). It lives in `.internal`, unpublished and unversioned |
| 2026-09-28 | **Spring Boot owns orchestration, governance and persistence; FastAPI is stateless.** | Python holds no DB connection, no job table, no session state. Nothing to lose on restart — which is what makes the no-Redis constraint safe. Python's quality output is advisory; Java re-enforces the contract before persisting |
| 2026-09-28 | **Source governance moved outside the agent.** Java clears URLs before Python ever sees them. | In the old project the policy gate was a wrapper *inside* the agent adapter (`FirecrawlAgentAdapter.ts:242-309`), so an agent could in principle be built without it. Structurally stronger position now |
| 2026-09-28 | **No `DEMO_MODE`, no silent fallbacks. Missing credential ⇒ startup failure.** | The old project substituted `DemoRequirementProvider` / `DemoWorkflowPlanProvider` when no LLM key was present (`requirements/index.ts:17-19`, `planner/index.ts:19-21`) and `DemoAgentAdapter` when no Firecrawl key was present (`server.ts:56-62`). Its `.env` had `DEMO_MODE=false` with an **empty** `FIRECRAWL_API_KEY`, so all collection was simulated while appearing real. This is the root cause of the hardcoded-schema defect |
| 2026-09-28 | **Drop `backend/src/modules/demo/` entirely.** | 834-line `scenarios.data.ts` hardcodes Tracxn/Inc42/YourStory sources, 52 real + 50 fabricated startups (founder `Dr. Ramesh Gupta N`), and `dynamic-scenario.generator.ts` hardcodes 15 YouTube channels behind a `prompt.includes("youtube"\|"channel"\|"video"\|"coding")` trigger (`:127`) — the exact prompt in the brief |
| 2026-09-28 | **Reuse the old Prisma domain model, including compound tenant-scoped foreign keys.** | `(workspace_id, id)` unique keys let FKs reference both columns, making cross-workspace links unrepresentable rather than merely unchecked. Best idea in the old schema. Translated to JPA + Flyway |
| 2026-09-28 | **Flyway, not Liquibase.** | The schema leans on MySQL-specific features (JSON, generated columns, ENUM, `FOR UPDATE SKIP LOCKED`), so SQL-first migrations are clearer than an abstraction layer, and versioned `.sql` files are easier to review |
| 2026-09-28 | **MySQL job queue with `FOR UPDATE SKIP LOCKED` / atomic conditional UPDATE claim, lease + heartbeat, and a stale-recovery sweeper.** | Anakin — the nominated job-architecture reference — has **no** durable claim at all: its queue is an in-process Go channel (`worker/worker.go:20-36,60-62`), grep confirms no `FOR UPDATE`, `SKIP LOCKED`, advisory lock or version column in `server/`, and it has no heartbeat or stale recovery. We adopt its patterns and add the durability it lacks. SQL in `docs/audit/J-no-redis-job-architecture.md` |
| 2026-09-28 | **Terminal job-state writes use `REQUIRES_NEW` with a short timeout.** | Anakin's `persistCtx` (`processor/processor.go:24-33`) uses `context.WithoutCancel` because the job context is already expired when recording failure — otherwise a timed-out job stays stuck in `processing` forever. The old project had no equivalent, and its in-process export promises stranded jobs in `RUNNING` on restart (`export.service.ts:41-53`) |
| 2026-09-28 | **Retry uses persisted `attempt_count` + exponential backoff with jitter.** | Anakin retries immediately with no backoff, keeps the count only in a loop variable, and ships `MAX_JOB_RETRIES` as dead config never read by the processor (`config.go:26,64`). The old project configured no BullMQ `attempts` and used `jobId = runId`, so a failed run could never be re-enqueued (`workflow-execution.service.ts:32`) |
| 2026-09-28 | **Single-node deployment for v1.** | Without Redis, SSE fan-out and per-domain rate limiting are in-process. Multi-node would silently drop live events and multiply the real request rate against sources — a governance violation, not just an inaccuracy. Claim SQL is still written for scale-out |
| 2026-09-28 | **`google-genai` with native structured output, not `pydantic-ai`.** | `agent-core-py` declares `pydantic-ai>=1.70.0` while current is `2.51.0` — a floor spanning a major version. We need no agent loop, so its main value is unused. Gemini's `response_schema` constrains decoding at the provider |
| 2026-09-28 | **Gemini schemas must strip the `const` keyword.** | Documented upstream failure mode (`agent-core/README.md:399-401`); Gemini is our default provider, so this would otherwise surface only at runtime |
| 2026-09-28 | **No code from `anakin-master` or `TheAgenticBrowser-main`.** | `anakin-master/NOTICE:1-4` = AGPL-3.0 (network-use clause would copyleft the product). `TheAgenticBrowser-main/LICENSE:1-30` §1.1 excludes providing a competing online service — which this platform is. Every reuse item is marked `PORT (concept only)` in `docs/audit/C-repository-reuse-map.md`. The old project reached the same conclusion and copied zero code from either (`Memory.md:56,127-128,139`) |
| 2026-09-28 | **`web-research-agent-master` (MIT) and Firecrawl `agent-core` (MIT) may be copied.** | Verified `LICENSE:1-3` (MIT, Copyright (c) 2025 Dev Dalia) and `agent-core/package.json:118` (`"license": "MIT"`). Caveat: upstream `agent-core/` ships **no LICENSE file** — the MIT declaration is metadata only. Keep notices with every copied file |
| 2026-09-28 | **PirateAgentUI's real CSS tokens are the design system of record; the old `Design.md` is superseded.** | `Design.md` specifies white/`#3B5BFF` blue/Inter in a "Linear/Vercel" idiom. The shipped UI is parchment `#E8DFCF` / brown `#5A3928` / tan `#B78B62` with Cormorant Garamond headings (`app/globals.css:6-43`, `tailwind.config.ts:48-50`). The brief requires preserving PirateAgentUI. Tokens recorded verbatim in `docs/audit/D-frontend-reuse-map.md` |
| 2026-09-28 | **Frontend fabrication removed on both sides of the contract.** | The UI invented confidence `90` and `sourceIds: src-1…src-n` (`datasets/[id]/page.tsx:120-131`); the API invented the *same* values (`datasets.routes.ts:240-251`) plus synthetic progress `100/50/0` (`workflows.routes.ts:92`) and `targetCount: 100` / `entity: "Record"` (`requirements.routes.ts:15,32`). Absent data must render as absent |

## 4. Database / Schema Changes

None yet. `docs/audit/E-database-model.md` specifies the target: 21 tables across 7 Flyway
migrations (`V1__baseline_identity` … `V7__seed_dev`), translated from the old project's 16
Prisma models plus three new tables — `workflow_jobs` (the MySQL queue), `refresh_tokens`
(replaces Redis revocation) and `source_domain_policy` (per-domain governance config).

## 5. Known Bugs / Issues / Verification Limits

Carried from the audit as things the rebuild must **not** reproduce:

1. **Authorization was effectively absent.** `app.ts:71-74` mounted only `optionalAuthenticate`;
   `requireWorkspaceAccess` was defined but never applied; `datasets.routes.ts:13` says
   "auth placeholder"; routes trusted client-supplied `workspaceId`/`userId`. An unauthenticated
   caller could read any workspace given its UUID — while `Memory.md:117` claimed authorization
   was "fully active".
2. **The live collection path was never runnable.** `DEMO_MODE=false` with an empty
   `FIRECRAWL_API_KEY` ⇒ `DemoAgentAdapter`. `Memory.md:112` admits no live Firecrawl call was
   ever made. The reported metrics (98.1% success, 52 records, 14 sources) came from the
   simulator, as did the 24 artifacts in `backend/demo-exports/`.
3. **`Memory.md:118` claimed no `.env` exists.** Two do (`.env`, `backend/.env`, byte-identical,
   22 populated variables). They are gitignored and untracked (verified via `git ls-files`), so
   nothing leaked to history — but the claim was false and the duplication is a drift hazard.
4. **Deployment topology could not have worked.** Compose ran the backend on :3000 with
   `FRONTEND_ORIGIN=localhost:5173` (a Vite port), while `next.config.js:15-22` hardcoded the API
   rewrite to `localhost:4000`.
5. **Forgeable tokens.** `server.ts:83-86` and `docker-compose.yml` both defaulted JWT secrets to
   literal strings.
6. **Seeded backdoor login** `demo@pirateagent.ai` / `Demo1234!` (`prisma/seed.ts:39-69`).
7. **Exports were not queued** — in-process promises stranded jobs in `RUNNING` on restart; the
   `EXPIRED` status and `expires_at` existed but nothing enforced them.
8. **Silent row loss** — `persistDataset` did `continue` on records without verified sources
   (`workflow-execution.repository.ts:271-272`), so datasets could land `PARTIAL` unexplained.
9. **Workflow runner was sequential only**; plan dependencies merely marked steps `SKIPPED`
   (`workflow-runner.ts:24,58-64`). `EXPORT` always returned `SKIPPED`/`EXPORT_NOT_IN_PHASE`
   (`:167-169`).
10. **Row search used `LIKE '%…%'` over a JSON column** with no index
    (`dataset-query.repository.ts:732-741`).
11. **`GET /api/v1/rows/:id/evidence`** passed 3 args to a 4-arg signature
    (`datasets.routes.ts:308`).
12. **Tests locked in demo behaviour** — `demo-scenarios.test.ts` and parts of
    `e2e-validation.test.ts` assert the hardcoded fixtures. Two integration suites are skipped by
    default, so "213 tests pass" excluded them.
13. **Dark mode was unreachable** — the `.dark` palette exists (`globals.css:45-72`) but nothing
    ever adds the class, and there is no `next-themes`.
14. **No-op Tailwind classes** — `shadow-xs`, `h-4.5`, `w-4.5`, `translate-x-5.5` do not exist in
    Tailwind v3 or the project config and silently render nothing.

Environment limits affecting verification:

- **Docker is not installed**, so Testcontainers is unavailable. Integration tests must run
  against the native MySQL 9.6 service on a disposable schema, gated by a property. Reports must
  state which tests ran and which were skipped.
- **Python 3.14.6 is installed but too new**; bare `python` resolves to the Windows Store alias
  and fails (`py` works). Python 3.12 must be installed before Phase 1.
- **No live external API call has been made during this audit.** Firecrawl and Gemini behaviour is
  documented from SDK/docs inspection, not execution. Phase 2 exists to verify it.

## 6. Open Decisions

| Gate | Question | Status |
|---|---|---|
| **G1** | With `DEMO_MODE` removed, how will this be demonstrated to judges? (a) test fixtures + run replay *(recommended)*, (b) guarded `SYNTHETIC_MODE` that can never trigger on a missing key, (c) funded keys and demo live. See `docs/audit/L-risks.md` R8 | **Awaiting user decision** |
| **G2** | Is the Firecrawl Python SDK's `interact` sufficient? Fallback is the Express sidecar implementing `agent-core/openapi.yaml` — a fourth runtime requiring its own recorded decision. See `docs/audit/I-firecrawl-integration.md` §I.6 | **Deferred to the Phase 2 spike** |

## 7. Environment / How to Run

Nothing to run yet. Target toolchain, verified present on this machine:

| Tool | Version | Status |
|---|---|---|
| Java | 21.0.8 LTS | present |
| Maven | 3.9.11 | present |
| Node / npm | 24.19.0 / 11.17.0 | present |
| MySQL | 9.6.0, service `MySQL96`, listening on 3306 + 33060 | present and running |
| Docker | — | **not installed** |
| Python | 3.14.6 at `…\Programs\Python\Python314`, pip 26.1.2 | present but **3.12 required**; `python` shadowed by the Windows Store alias |

Environment variables are specified in `docs/audit/K-environment-variables.md`. No `.env` exists
in this project yet, and no secret value is recorded in any file here.

## 8. Next Step

Phase 1 — Foundation & skeleton (`docs/audit/M-phase-plan.md`). **Not started.** Per the
discipline rule, it begins only after G1 is decided and Phase 0 is signed off.
