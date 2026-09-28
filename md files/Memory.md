# Memory.md — Living Project Memory

### Project: AI-Powered Data Intelligence Platform

## 1. Current Status

- **Current Phase:** Phase 8 — Reference-repository usage audit complete; Phase 8 data-intelligence services are not implemented.
- **Last updated:** 2026-09-28.
- **App runnable end-to-end:** Prompt parsing, plan generation/persistence, BullMQ-backed run execution, Firecrawl step adapters, source governance, step/event persistence, and evidence-backed dataset saving are wired. Live provider verification is opt-in.
- **Git state:** `origin` is configured for `main`; phase work is pushed per the project request.

## 2. Completed Phases / Features

- [x] Phase 0 — Repository and architecture forensic audit. Firecrawl Agent Core is the primary foundation; its MIT source is vendored locally with provenance metadata. Other reference repositories were not merged.
- [x] Phase 1 — Backend workspace, strict TypeScript, Express foundation, environment validation, logging, Prisma/MySQL and Redis/BullMQ wiring, health/readiness, tests, and setup documentation.
- [x] Phase 2 — Workspace-scoped domain schema, two Prisma migrations, development seed, dataset row/provenance repository, and MySQL integration tests.
- [x] Phase 3 — Strict requirement schemas, configurable structured-output provider, prompt template, ambiguity/validation result, and `POST /api/v1/requirements/parse`.
- [x] Phase 4 — Strict versioned workflow plan schema, configurable LLM planner with one validation-correction attempt, workspace membership check, planning lifecycle persistence, and `POST /api/v1/workflows/plan`. No collection steps are executed.
- [x] Phase 5 — `FirecrawlAgentAdapter`, `MockAgentAdapter`, event/result normalization, Firecrawl configuration health check, `POST /api/v1/workflows/execute`, workflow run persistence, and prompt-to-agent end-to-end mock coverage.
- [x] Phase 6 — Plan allow/deny domain rules, URL normalization/validation, robots policy checks, Redis sliding-window rate limits, bounded request timeout/retry, source lifecycle/reason persistence, and safe alternative-source continuation.
- [x] Phase 7 — BullMQ workflow runs, dependency-ordered safe step runner, per-step status/retry/timing/source references, cancellation requests, activity events, evidence-backed dataset persistence, run/step APIs, worker error handling, and runner tests.
- [x] Phase 8 audit-only — Verified actual imports, workflow integration, source files, and licenses for all four local reference repositories. No application code or data-intelligence services were changed in this audit.
- [ ] Phase 8 implementation — Dedicated normalization, field/schema validation, source verification state, persisted deduplication decisions, entity resolution, and data-quality orchestration remain pending.
- [ ] Later product phases — Not started. Follow the user's explicit phase prompts; do not infer authorization to implement later work.

## 3. Key Architectural Decisions Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-09-27 | Use npm workspaces with `backend/` and `packages/firecrawl-agent-core/`. | Keeps the server TypeScript-native and the selected agent core isolated and traceable. |
| 2026-09-27 | Vendor only Firecrawl Agent Core source and its MIT license; do not merge the other reference repositories. | The package was unavailable from npm and the local reference snapshot had no Git metadata. Other repositories remain reference-only under their license/architecture constraints. |
| 2026-09-27 | Use UUID strings and workspace IDs on tenant-owned entities, plus compound foreign keys for same-workspace workflow/run/dataset relationships. | Prevents accidental cross-workspace links and supports per-workspace queries. |
| 2026-09-27 | Store dynamic dataset values and versioned plan definitions as JSON; store dataset columns, evidence, validation issues, and deduplication decisions relationally. | Preserves flexible data contracts while keeping provenance and common metadata queryable. Raw page bodies are not persisted in MySQL. |
| 2026-09-27 | Require row creation through `DatasetRepository.insertRowWithEvidence`. | Persists row and evidence in one transaction, rejects rows without evidence, and verifies sources were fetched in the dataset's workflow run. |
| 2026-09-27 | Keep authentication inactive; retain nullable password hashes and workspace membership models for later auth phases. | Phase 2 defines persistence and ownership boundaries but does not implement login/session behavior. |
| 2026-09-27 | Reuse the vendored Agent Core `resolveModel` through a requirement-provider interface; use AI SDK structured output and revalidate with Zod. | Uses the same configurable provider resolution as the agent while keeping requirement analysis independently mockable and free of collection tools. The direct `ai` dependency is pinned to the same 6.0.293 Apache-2.0 version already resolved for Agent Core. |
| 2026-09-27 | Return `needs_clarification` for unresolved entity, objective, fields, or explicit ambiguity; fail closed on malformed model output or provider errors. | Prevents invented requirements and ensures this stage cannot silently perform web collection. |
| 2026-09-27 | Add a separate workflow-planning service that uses the same Agent Core model resolver, only accepts the fixed step vocabulary, validates generated JSON with Zod, retries one invalid plan with issue feedback, and saves only validated versioned plans. | Keeps requirement understanding separate from planning, prohibits untrusted tool names, and makes the generated workflow inspectable before any execution phase. |
| 2026-09-27 | Persist workflow planning lifecycle (`NOT_STARTED`, `PLANNING`, `PLANNED`, `FAILED`) and sanitized failure details on Workflow; save the structured requirement and completion criteria in each WorkflowPlan. | Makes planning failures durable and allows plan versions to retain a complete input/output audit record. |
| 2026-09-28 | Use Firecrawl Agent Core via a typed adapter and derive Search/Scrape/Interact availability from the validated workflow plan. | Retains Firecrawl's agent loop, provider selection, structured output, skills, subagents and stream while keeping business workflow policy in this platform. Map/crawl remain disabled; no large Agent Core implementation was copied. |
| 2026-09-28 | Keep routine tests provider-independent and add a separately gated live Agent Core test. | `MockAgentAdapter` exercises the whole parse → plan → run → normalized response contract without paid calls. |
| 2026-09-28 | Reimplement source governance in TypeScript; do not copy from the MIT web-research-agent. | Its actual `utils/web_scraper.py` checks robots and uses exponential retries, and `utils/get_relevant_urls.py` ranks/deduplicates URLs. The platform uses its own domain rules, lifecycle persistence, Redis rate limit, and plan-configured retry/timeout. |
| 2026-09-28 | Fail closed on robots fetch errors and apply rules for `SOURCE_ROBOTS_USER_AGENT`; deny rules override allow rules. | Prevents collection where robots status cannot be established and makes domain exceptions inspectable. |
| 2026-09-28 | Enqueue workflow runs in BullMQ and execute validated plan steps sequentially. | Enforces declared dependencies before downstream work starts; plan text is never evaluated as code. Step retries are bounded by the saved retry policy. |
| 2026-09-28 | Make cancellation durable and cooperative at workflow step boundaries. | Current Agent Core `RunParams` has no run-level abort signal; cancellation is persisted immediately and prevents later steps while a bounded in-flight collection call finishes. |
| 2026-09-28 | Persist row-level source evidence rather than inventing field-level citations. | Agent results provide source URLs per record, not independently verified per-field source mappings. |
| 2026-09-28 | Keep Firecrawl Agent Core as the only directly vendored reference implementation; use Web Research Agent and Anakin as behavior/design references, and do not copy TheAgentic Browser code without legal review. | Firecrawl and Web Research Agent are MIT; Anakin is AGPL-3.0; TheAgentic Community License excludes competing online services. Current backend imports no code from the latter three repositories. |

## 4. Database / Schema Changes

- Prisma 6.12 MySQL models are in `backend/prisma/schema.prisma`.
- Added users, workspaces, workspace members, workflows, versioned workflow plans, workflow runs, workflow steps, datasets, dataset columns/rows, sources, source evidence, validation issues, deduplication events, export jobs, and activity events.
- Added migrations `20260927143730_phase2_domain_model` and `20260927144412_workspace_membership_state` under `backend/prisma/migrations/`.
- Added migration `20260927161607_workflow_planning_state` for planning status/error fields and complete plan requirement/completion criteria.
- Seed command creates an idempotent development user/workspace only and refuses `APP_ENV=production`.
- Database tests run against local `aidp_dev` MySQL using credentials supplied transiently to the shell; credentials are not stored in source, `.env`, or this file.
- Requirement schema, provider, service, prompt, and route are under `backend/src/modules/requirements/` and `backend/src/routes/requirements.routes.ts`. API path is `POST /api/v1/requirements/parse`.
- Planner schema/provider/service/prompt are under `backend/src/modules/planner/`; persistence is in `backend/src/db/repositories/workflow-planner.repository.ts`, and the endpoint is in `backend/src/routes/workflows.routes.ts`.
- Agent contract/adapters/normalizer/event mapper are in `backend/src/agent/`. Firecrawl execution consumes only tools represented by the persisted validated plan. The platform wrapper constrains explicit blocked domains, public HTTP(S) targets, and per-domain Scrape/Interact request ceilings. Existing core supplies `structured-extraction`; Firecrawl tool parsing reuses the core's `parseToolResult` utility.
- `backend/src/modules/workflows/workflow-execution.service.ts` parses/plans and enqueues. `WorkflowRunner` reloads and revalidates the stored plan, claims a pending run once, enforces dependencies, and executes only fixed step handlers. Each Firecrawl collection call is limited to its current Search/Scrape/Interact/Extract step. Transform, validation, normalized deduplication, provenance aggregation, and evidence-backed Save steps execute in the worker. Export is reported as `SKIPPED` until its phase is implemented.
- API additions: `POST /api/v1/workflows/execute` now returns `202` with a queued run; `POST /api/v1/workflows/:id/run` starts a saved plan; `POST /api/v1/runs/:id/cancel` requests cancellation; `GET /api/v1/runs/:id` and `GET /api/v1/runs/:id/steps` expose run and step history. Run reads and cancellation check active workspace membership.
- The API starts a BullMQ worker at concurrency 2. Step status, retry count, duration, timestamps, safe input/output summaries, errors, source IDs, and activity events are persisted. Run claiming and cancellation are conditional to handle duplicate-job and completion races; unexpected worker errors mark the run failed.
- `SAVE` creates a dataset and typed columns, then persists rows and row-level evidence in a transaction. Evidence links only to collected/fetched sources from that run. Validation issues are persisted; field-level attribution is not claimed because the agent currently supplies record-level source URLs.
- Added a gated live test at `backend/tests/agent.integration.test.ts` (`RUN_FIRECRAWL_INTEGRATION_TESTS=true`) and a regular mocked end-to-end test. Firecrawl Agent Core vendored type gained `apiUrl` pass-through for configured Firecrawl base URL.
- Phase 6 source services are under `backend/src/modules/sources/`: `SourcePolicyService`, `SourceValidator`, `RobotsPolicyService`, `RateLimitService`, and `RetryPolicy`. `WorkflowSourceRepository` persists source lifecycle records in MySQL and deduplicates normalized URLs by run hash.
- Added migration `20260928121300_source_governance` with source states `ALLOWED`, `QUEUED`, `PROCESSING`, `COLLECTED`, policy/robots reasons and timestamps, attempt count, metadata JSON, and a workspace/status index. Legacy `FETCHED` remains supported; dataset evidence accepts both `FETCHED` and `COLLECTED`.
- Added migration `20260928140000_phase7_workflow_execution` for run cancellation requests and step retry count, duration, and source ID references. Run and step transitions are persisted as workspace `ActivityEvent` records.
- Phase 8 audit made no schema or migration changes. The current schema does not yet persist field-level verification/confidence, entity-resolution decisions, or a dedicated data-quality pipeline run.
- Workflow plan `sourcePolicy.allowedDomains` is optional and defaults to an empty (unrestricted) allowlist. `blockedDomains` takes precedence; rules match exact domains and subdomains. Search result candidates are checked/persisted and excluded from agent-visible search output when disallowed.
- Robots policy uses a bounded native HTTP fetch, parses user-agent groups, allow/disallow specificity, and crawl delay, and caches per origin. Robots fetch errors/HTTP access failures fail closed. Redis Lua sliding-window limits are checked for each actual request attempt, including retries. Timeout/retry settings come from the validated workflow step.
- Source records preserve title/snippet metadata, normalized/canonical URL/hash, lifecycle state, reason/error code, robots result/check time, request attempt count/time, and retrieval time. Full web page bodies are not saved.
- Added `backend/tests/source-governance.test.ts` and MySQL lifecycle/provenance assertions. `.env.example` now includes `SOURCE_ROBOTS_USER_AGENT` and `SOURCE_ROBOTS_TIMEOUT_MS`.

## 5. Known Bugs / Issues / Verification Limits

- The live integration tests ran successfully against the installed MySQL 9.6 service. MySQL 8.4 remains the version in `docker-compose.yml`; Docker is unavailable here, so that exact service version was not started.
- Redis is not running locally; readiness was not rechecked in this phase. Phase 1 records that `/ready` returns 503 when required services are unavailable.
- Integration tests require `RUN_DATABASE_TESTS=true` and a migrated disposable database. The normal `npm test` run skips these integration checks when that flag is absent.
- No live Firecrawl/LLM request was run during Phase 5; the regular suite uses mocks. Live provider behavior remains unverified until the gated test is deliberately enabled with valid keys. Secrets supplied in chat were not written to files, logs, or this memory; rotate them before ongoing use.
- The Phase 7 migration was deployed to local `aidp_dev`; all six MySQL integration tests passed against it.
- Cancellation persists immediately and prevents later steps. An active Agent Core operation cannot be force-aborted through the current public `RunParams`; it finishes under source request timeout/retry controls before the worker records cancellation.
- Robots policy is preflighted by this service before Scrape/Interact. Site terms are still policy instructions and are not automatically parsed from legal pages. Search provider calls themselves are not rate-limited per result domain; the per-domain limit gates actual Scrape/Interact attempts.
- Request timeouts bound how long the application waits and abort the provided signal; whether the upstream Firecrawl SDK cancels an already-running remote request depends on SDK support. Rate limiting requires Redis and fails closed if Redis is unavailable.
- Authentication remains inactive; execution caller supplies `createdById`, which is checked for active workspace membership. Bind it to the authenticated principal when auth is implemented.
- No `.env` file exists. `.env.example` contains placeholders.
- The requested remote is configured as `origin`; no credential values are stored in project files.

## 6. Phase 8 — Reference Repository Usage Audit (Audit Only)

- Firecrawl is genuinely integrated through the local npm workspace package `@aidp/firecrawl-agent-core` (`packages/firecrawl-agent-core/`), sourced from `githubrepos/web-agent-main/agent-core`. Hash comparison found 54 upstream files, 46 common paths, 43 byte-identical files, and three modified common files (`package.json`, `tsconfig.json`, `src/types.ts`); the local package is renamed/versioned `@aidp/firecrawl-agent-core` and `src/types.ts` includes the configured Firecrawl API URL pass-through. `UPSTREAM.md` records MIT provenance but no upstream commit because the local snapshot has no Git metadata.
- Direct Firecrawl imports are in `backend/src/agent/FirecrawlAgentAdapter.ts` (`createAgent`, `buildFirecrawlToolkit`, core types), `AgentResultNormalizer.ts` (`parseToolResult`, run/step types), `AgentEventMapper.ts` (event type and tool parsing), `types.ts` (event type), and `backend/src/modules/requirements/provider.ts` plus `backend/src/modules/planner/provider.ts` (`resolveModel`, `ModelConfig`). Adapter-specific safety, workflow-step gating, source policy, output schema and platform event/result contracts are platform code, not upstream source.
- The real runtime path is `backend/src/routes/workflows.routes.ts` → `backend/src/modules/workflows/workflow-execution.service.ts` (`RequirementParser.parse` → `WorkflowPlanner.plan` → BullMQ enqueue) → `backend/src/server.ts` (wires `FirecrawlAgentAdapter` into `WorkflowRunner` and starts the worker) → `backend/src/modules/workflows/workflow-runner.ts` (dispatches SEARCH/SCRAPE/INTERACT/EXTRACT steps) → `backend/src/agent/FirecrawlAgentAdapter.ts` (`buildFirecrawlToolkit`, `createAgent`, `agent.stream`, JSON schema, `structured-extraction` skill) → `AgentResultNormalizer` and `AgentEventMapper`. Search, Scrape, and Interact are selected from the validated plan and gated per current step. The normal end-to-end test path uses mocks; `backend/tests/agent.integration.test.ts` is opt-in, and live-provider operation was not verified in this audit.
- Web Research Agent (`githubrepos/web-research-agent-master`, MIT) is not imported. Audited implementations include `utils/web_scraper.py` (`allowed_to_scrape`, `fetch_page`, exponential retries), `utils/get_relevant_urls.py` (`get_relevant_urls`, embedding-based relevance/deduplication), `utils/analyze_query.py` (`analyze_query`), and `tools/result_aggregator_tool.py` (`run_result_aggregator_tool`). The backend independently implements source policy/robots/retry in `backend/src/modules/sources/`; it does not yet use the reference relevance-ranking or query-analysis implementation. Future native TypeScript equivalents can borrow those concepts; the Python modules and their dependencies are not wired into this Node service.
- TheAgentic Browser (`githubrepos/TheAgenticBrowser-main`) is not imported. Its Planner → Browser → Critique loop is visible in `core/agents/planner_agent.py`, `core/agents/browser_agent.py`, `core/agents/critique_agent.py`, and `core/orchestrator.py` (`Orchestrator`). This is architecture reference only. Its Community License Agreement §1.1 excludes competing SaaS/platform/infrastructure or similar online services; do not copy or adapt source code for this product absent explicit legal approval. Any future reliability loop should be designed independently around the product's fixed safe workflow vocabulary and permission controls.
- Anakin (`githubrepos/anakin-master`, AGPL-3.0) is not imported. Its worker/job and persistence patterns are in `server/internal/worker/worker.go` (`Pool`, `Start`, `Submit`, `Drain`), `server/internal/processor/processor.go` (`Processor.ProcessJob`, `processScrapeJob`, `handleFailure`), `server/internal/store/store.go` (`JobStore`) and `server/internal/store/postgres.go`; job states/types are in `server/internal/models/types.go`, HTTP APIs in `server/internal/http/handlers/scraper.go` and `server/internal/http/router/router.go`. The current app independently uses BullMQ and Prisma/MySQL (`backend/src/queue/workflowQueue.ts`, `backend/src/server.ts`, and `backend/src/db/repositories/workflow-execution.repository.ts`). AGPL obligations may apply to network-accessible modified/derivative software; retain as reference-only unless legal review approves reuse.
- No application imports, package dependencies, or source copies from Web Research Agent, TheAgentic Browser, or Anakin were found. Their repositories remain reference-only. Future use means independently implementing suitable ideas in the current TypeScript/MySQL/BullMQ stack, subject to license review.
- Phase 8 gap found: no dedicated `NormalizationService`, `ValidationService`, `DeduplicationService`, `EntityResolutionService`, or `DataQualityService` exists. `backend/src/modules/workflows/workflow-runner.ts` currently contains inline `applyTransformations`, `validateRecords`, and `deduplicateRecords` helpers. They cover a limited set of transformations and required/type/URL/email/date/source-evidence checks; RANGE/CUSTOM rules are reported as warnings, and `FUZZY_REVIEW` is skipped. Deterministic dedup currently merges same computed exact/normalized keys and aggregates source URLs; it does not persist decision events in this runner path, resolve entities, support URL duplicates as a dedicated strategy, or track field-level confidence/verification. This is partial execution support, not completion of the Phase 8 pipeline.

## 7. Pending Work / Next Steps

- Phase 8 audit is complete. Stop here and wait for the next phase prompt; Phase 8 data-intelligence implementation remains pending.
- Authentication is not implemented. For now `createdById` is supplied by the caller and checked against active workspace membership; a future auth phase must bind it to an authenticated principal.
- `Phases.md` uses older phase numbering; follow the user's current phase prompts and do not build its later planner phase early.
- Before syncing Firecrawl Agent Core, establish and record the exact upstream commit/tag and review its diff/license.

## 8. Environment / Commands / Configuration

- **Requirements:** Node.js 20+, npm, MySQL 8+; Docker Compose provides local MySQL 8.4 and Redis 7 when available.
- **Local setup:** `Copy-Item .env.example .env`; `docker compose up -d`; `npm install`; `npm run db:generate`; `npm run db:migrate --workspace @aidp/backend -- --name init`; `npm run db:seed`; `npm run dev`.
- **Migration deploy:** `npm run db:deploy`.
- **Checks:** `npm run typecheck`; `npm run lint`; `npm test`; `npm run test:db` with `RUN_DATABASE_TESTS=true` and `DATABASE_URL`; `npm run build`; `npm audit`.
- **Schema validation:** `npm run db:validate`.
- **Environment variables:** `APP_ENV`, `PORT`, `FRONTEND_ORIGIN`, `LOG_LEVEL`, `REQUEST_BODY_LIMIT`, `SOURCE_ROBOTS_USER_AGENT`, `SOURCE_ROBOTS_TIMEOUT_MS`, `DATABASE_URL` or `MYSQL_HOST`/`MYSQL_PORT`/`MYSQL_USER`/`MYSQL_PASSWORD`/`MYSQL_DATABASE`, `REDIS_URL`, `FIRECRAWL_API_KEY`, `FIRECRAWL_BASE_URL`, `LLM_PROVIDER`, `LLM_MODEL_ID`, provider credentials, and paired `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` when auth is introduced.
- **API:** `GET /health`, `GET /ready`, `GET /health/firecrawl`, `POST /api/v1/requirements/parse`, `POST /api/v1/workflows/plan`, `POST /api/v1/workflows/execute`, `POST /api/v1/workflows/:id/run`, `POST /api/v1/runs/:id/cancel`, `GET /api/v1/runs/:id`, and `GET /api/v1/runs/:id/steps`. Long runs are queued; `SAVE` persists datasets, rows, and row-level evidence through `DatasetRepository`. Auth is not active.
- **Data services:** `docker-compose.yml` defines local MySQL 8.4 and Redis 7.

## 9. Notes for the Next AI Session

- Read `PRD.md`, `Architecture.md`, `Rules.md`, `Phases.md`, `Design.md`, and this memory before starting new phase work.
- Backend sources are under `backend/src/`; Prisma schema, migrations, and seed are under `backend/prisma/`.
- Dataset row persistence must go through `DatasetRepository.insertRowWithEvidence` to preserve the source-evidence invariant.
- Frontend is separate and must not be implemented unless specifically requested.

## 10. Last Session Summary

Phase 8 request was handled as an audit-only task. Verified the Firecrawl Agent Core package and real queued execution path, the three other repositories' actual relevant modules, and all four licenses. Firecrawl is vendored/imported; the other repositories are not imported. No application code was changed. The current worker has inline partial transformation/validation/deduplication helpers; the dedicated Phase 8 data-intelligence services and richer persisted quality/provenance decisions remain unimplemented. No tests or builds were run because this was an inspection-only request. `Memory.md` was updated with the audit findings. Stop and wait for the next phase.
