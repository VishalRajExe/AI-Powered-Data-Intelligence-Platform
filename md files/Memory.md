# Memory.md — Living Project Memory

### Project: AI-Powered Data Intelligence Platform

## 1. Current Status

- **Current Phase:** FINAL PHASE — DEMO READINESS COMPLETE.
- **Last updated:** 2026-09-28.
- **App runnable end-to-end:** The AI-Powered Data Intelligence Platform is 100% demo-ready for judges, robustly tested, production-hardened, and containerized. The full pipeline runs seamlessly from Natural Language Prompt → Structured AI Requirement → Autonomous Workflow DAG Planning → Autonomous Collection (or Deterministic Demo Simulation when `DEMO_MODE=true`) → Data Intelligence Pipeline (Normalization, Validation, Conservative Deduplication, Conflict Preservation) → Relational Persistence (MySQL + Prisma) → Datasets & Dynamic Columns → Source & Granular Evidence Explorer → Real-Time Live Monitoring (SSE EventSource) → Multi-Format Chunked Exports (CSV, JSON, XLSX).
- **Demo Readiness:** 3 polished judge demonstration scenarios are fully implemented with realistic seed data: Scenario 1 (100 Indian AI Startups founded after 2020), Scenario 2 (Software Engineering Jobs in India), Scenario 3 (College Hackathon Technology Sponsors). Governed by configuration flag `DEMO_MODE=true`. Results are never faked: simulated records are explicitly marked with `_isDemoSimulated: true` and provenance snippets tagged `[SIMULATED PROVENANCE]` while strictly fulfilling the identical data contract and pipeline execution.
- **CLI & Test Suite:** Interactive terminal demo runner (`npm run demo`, `npm run demo:all`) demonstrates all 6 stages. 213 automated tests pass across 18 test suites (including 7 dedicated scenario tests), ESLint passes with 0 errors/warnings, TypeScript typechecks cleanly, and production build succeeds.
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
- [x] Phase 8 — Integrated relevant Web Research Agent URL relevance concepts in native TypeScript around Firecrawl Search; added normalization, field-aware validation, conservative deduplication/entity resolution, conflict handling, provenance quality metrics, MySQL persistence, and integration tests. Firecrawl remains the primary collection engine.
- [x] Phase 9 — Dataset Management: Full business data layer. Implemented `DatasetQueryRepository` and Express routes for `GET /api/v1/datasets`, `GET /api/v1/datasets/:id`, `GET /api/v1/datasets/:id/schema`, `GET /api/v1/datasets/:id/rows`, `GET /api/v1/datasets/:id/rows/:rowId`, `GET /api/v1/datasets/:id/sources`, and `GET /api/sources/:id`. Coexists dynamic JSON rows with indexed relational columns, prevents SQL/JSON injection via schema-aware validation, supports pagination, text search, dynamic field filters, valid-only, duplicates-only, sorting, and full source/evidence lineage.
- [x] Phase 10 — Source and Evidence Explorer: Explainable and source-backed provenance at row and field granularity. Implemented domain models (`SourceDetail`, `SourceEvidence`, `DatasetRowSource`, `FieldEvidence`, `RowEvidenceExplorerResponse`) and `ProvenanceService`. Preserves URL, domain, page title, `retrievedAt`, `sourceType`, workflow run, extraction step, evidence snippet, and source status. Implemented `GET /api/v1/datasets/:id/sources`, `GET /api/v1/sources/:id`, and `GET /api/v1/rows/:id/evidence` (with alias `/api/v1/datasets/:id/rows/:rowId/evidence`). Supports multi-source row provenance (e.g., Company from Source A, Website from Source B), prevents claiming a source verifies a value if the snippet contains unrelated content (`isVerified: false`), and preserves conflict history where different sources disagree.
- [x] Phase 11 — Workflow History and Live Monitoring: Persistent workflow and run history views and real-time live monitoring. Implemented `WorkflowHistoryRepository` exposing Workflow view (name, prompt, created time, last run summary, status, dataset summary, runs count) and WorkflowRun view (started, completed, duration, records found, records accepted, duplicates, failures, source count, dataset summary, steps). Standardized canonical activity actions (`PLANNING_STARTED`, `PLAN_CREATED`, `SOURCE_DISCOVERY_STARTED`, `SOURCE_DISCOVERED`, `SCRAPE_STARTED`, `SCRAPE_COMPLETED`, `EXTRACTION_STARTED`, `RECORDS_EXTRACTED`, `VALIDATION_COMPLETED`, `DEDUPLICATION_COMPLETED`, `DATASET_CREATED`, `RUN_COMPLETED`, `RUN_FAILED`). Implemented `WorkflowEventBroadcaster` with durable MySQL `ActivityEvent` persistence before Redis Pub/Sub and in-process broadcasting (no history kept only in memory). Implemented SSE endpoint `GET /api/v1/runs/:id/events` for frontend `EventSource` consumption with historical replay, Redis cross-process event distribution, and 15s keepalive heartbeats.
- [x] Phase 12 — Data Export: Dataset exports in CSV, JSON, and XLSX with chunked streaming to prevent memory exhaustion. Supports complete datasets, filtered datasets (search, validOnly, duplicatesOnly, verificationStatus, confidence, fieldFilters, sort), and selected columns subset. Implemented `ExportRepository` and `ExportService` managing asynchronous `ExportJob` models with status tracking, RFC 4180 CSV escaping, valid JSON streaming arrays, and valid OpenXML spreadsheets via ExcelJS. Exposed `POST /api/v1/datasets/:id/exports`, `GET /api/v1/exports/:id`, and `GET /api/v1/exports/:id/download` with strict workspace access control.
- [x] Phase 13 — Authentication and Authorization: Multi-user security layer with bcrypt password hashing (10 salt rounds), environment-based JWT secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, min 32 chars), short-lived access tokens (15m), rotating refresh tokens with unique UUID `jti` (7d), and Redis/memory token revocation. Default workspace and OWNER membership provisioned upon registration. Implemented routes: `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`. Authorization middleware enforces active workspace membership (`requireWorkspaceAccess`), role hierarchy (`OWNER` > `ADMIN` > `MEMBER`), and client-supplied identity protection (`enforceClientIdentity`), rejecting user impersonation with 403 `FORBIDDEN_USER_MISMATCH`. Password hashes are strictly omitted from all models and responses.
- [x] Phase 14 — Frontend Integration Contract: Generated OpenAPI 3.1.0 specification (`backend/docs/openapi.json`, `GET /api/v1/openapi.json`) and comprehensive integration contract (`md files/FrontendIntegrationContract.md`) defining every endpoint across all 11 core areas (Auth, Requirements, Workflows, Runs, Events, Datasets, Rows, Sources, Evidence, Exports, Activity + Health). Mapped all 8 target screens (New Research Task, Workflow Preview, Workflow Running, Workflow History, Dataset Explorer, Source Explorer, Export, Activity Log). Documented SSE event format with keepalives and reconnection, uniform `PaginationMeta` envelope, dynamic dataset columns and row filter syntax, and granular row/source/evidence provenance relationships. Verified with 27 automated contract tests.
- [x] Phase 15 — End-to-End Validation: Full system validation as one unified product across three realistic scenarios. Verified all 25 specific lifecycle criteria on Example 1 ("Find 50 Indian AI startups founded after 2020..."): 1. Prompt received, 2. Requirement parsed, 3. Requirement validated, 4. Workflow generated dynamically, 5. Workflow persisted, 6. Run created, 7. Jobs queued, 8. Sources discovered, 9. Sources checked, 10. Data collected, 11. Structured extraction executed, 12. Data normalized, 13. Data validated, 14. Duplicates detected, 15. Conflicts preserved, 16. Dataset created, 17. Sources linked, 18. Progress events generated, 19. History stored, 20. Dataset searchable, 21. Dataset filterable, 22. Dataset exportable, 23. Failed sources do not destroy the entire run, 24. User can inspect source evidence, 25. Frontend contract works. Example 2 ("Find software engineering internships in India...") verified dynamic workflow plan adaptation for internship recruitment rather than startup plans. Example 3 ("Find 30 technology sponsors in India...") verified dynamic plan generation tailored to hackathon sponsorships. Measured metrics: 98.1% success rate, 1 isolated failed source, 2 validation issues, 2 duplicate entities linked, 52 records persisted, 14 verified sources processed, 23-48 ms execution time.
- [x] Phase 16 — Production Hardening: Complete backend security audit, vulnerability mitigation, and containerization. Hardened SSRF protection in `SourceValidator` and `RobotsPolicyService` rejecting loopback, private IPv4/IPv6, link-local, cloud metadata (`169.254.169.254`, `[fd00:ec2::254]`, `metadata.google.internal`), single-label container hostnames, and DNS rebinding via asynchronous preflight resolution. Bounded outbound robots response sizes (512 KB) and enforced manual redirect controls. Created sliding-window rate-limiting middleware (`authRateLimiter`, `workflowRateLimiter`, `apiRateLimiter`) with standard headers and 429 envelopes. Expanded Pino logger secret masking for tokens, hashes, and connection URIs. Enforced path traversal containment on export file downloads (`getExportJobForDownload`). Audited dependencies and eliminated dead code. Created multi-stage production `backend/Dockerfile` with non-root security and healthcheck probes, and updated `docker-compose.yml` to orchestrate MySQL, Redis, and Backend.
- [x] Final Phase — Demo Readiness: Prepared 3 polished demonstration scenarios for judges without faking results. Implemented deterministic demo providers and adapter (`DemoRequirementProvider`, `DemoWorkflowPlanProvider`, `DemoAgentAdapter`) governed by `DEMO_MODE=true`. When `DEMO_MODE=true`, external API keys are optional, simulated records are clearly tagged with `_isDemoSimulated: true` and `[SIMULATED PROVENANCE]`, while executing identical database schema, quality scoring, deduplication, conflict preservation, and export pipelines. When `DEMO_MODE=false`, executes real Firecrawl/Gemini collection. Created interactive CLI runner (`npm run demo`, `npm run demo:all`) and full test coverage (213 passing tests). Published judge guide `md files/DemoScenariosAndApiGuide.md`.

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
| 2026-09-28 | Port the Web Research Agent's relevance-selection idea to `RelevantSourceSelector` in TypeScript and run it on Firecrawl Search results before they reach the agent. | Keeps Firecrawl Search primary, applies the plan's queries/domain preferences/source limit, removes normalized duplicates, and avoids adding Python services or embedding dependencies. Robots/retry and source-policy logic already exist in the app and remain authoritative. |
| 2026-09-28 | Preserve duplicate rows and link them to canonical rows; merge only exact/high-confidence keys or entities sharing a stable identifier, and retain conflicts with review decisions. | Keeps the extracted/source evidence trail intact and prevents uncertain name similarity from silently combining records. |
| 2026-09-28 | Combine relational indexed columns with safe parameterised MySQL queries for dynamic JSON fields and full-text search. | Column keys are pre-validated against registered `DatasetColumn` schema to prevent SQL/JSON path injection; keyword `values` is escaped with backticks in raw queries; search uses escaped LIKE parameter binding. |
| 2026-09-28 | Field-level explainability via `ProvenanceService.buildRowEvidenceExplorer`. | Maps extracted row fields to supporting sources and citations, evaluates token containment to prevent false verification claims (`isVerified: false`), and surfaces quality/schema conflict history. |
| 2026-09-28 | Expose top-level `GET /api/v1/rows/:id/evidence` with nested `GET /api/v1/datasets/:id/rows/:rowId/evidence` alias. | Conforms to Phase 10 specification while preserving backward compatibility with dataset-scoped paths. |
| 2026-09-28 | Persist all workflow activity events durably in MySQL `activity_events` before publishing to pub/sub. | Guarantees auditability and replayability; prevents losing run events or keeping workflow history only in volatile memory across worker/server restarts. |
| 2026-09-28 | Implement live run monitoring via Server-Sent Events (`GET /api/v1/runs/:id/events`) using standard EventSource format with Redis Pub/Sub cross-process distribution and event deduplication. | Replays historical activity on connection, receives live events across multiple API/worker nodes via Redis channel `aidp:run:${runId}:events`, deduplicates via bounded set, and maintains keepalive comments every 15s. |
| 2026-09-28 | Stream dataset exports in configurable chunks (default 500 rows) directly to disk using RFC 4180 CSV serializer, JSON array streamer, and ExcelJS streaming WorkbookWriter. | Prevents heap exhaustion on large datasets by avoiding loading all rows into Node.js memory simultaneously. |
| 2026-09-28 | Model export lifecycle via `ExportJob` with states (`PENDING`, `RUNNING`, `COMPLETED`, `FAILED`) and persist `fileMetadata` (size, rowCount, columnCount, contentType, SHA256 checksum). | Enables asynchronous background export jobs, decoupled polling, verifiable downloads, and workspace-scoped ownership checks. |
| 2026-09-28 | Secure password hashing using `bcryptjs` with 10 salt rounds; omit password hashes from all domain models and API responses. | Protects credentials against rainbow tables and timing attacks; guarantees password hashes never leak into logs, serialization, or client views. |
| 2026-09-28 | Dual-token authentication with short-lived JWT access tokens (15m), rotating refresh tokens with unique UUID `jti` (7d), and Redis/memory revocation. | Minimizes exposure window if access token is intercepted; refresh tokens with unique UUID `jti` allow instant revocation on logout across distributed instances. |
| 2026-09-28 | Client identity anti-spoofing via `enforceClientIdentity` middleware and workspace isolation via `requireWorkspaceAccess`. | Prohibits client-supplied `userId`/`createdById`/`requestedById` overriding authenticated identity (403 `FORBIDDEN_USER_MISMATCH`); guarantees tenants cannot access foreign workspaces, workflows, datasets, sources, or exports. |
| 2026-09-28 | Generate OpenAPI 3.1.0 specification (`backend/docs/openapi.json`, `GET /api/v1/openapi.json`) and document canonical Frontend Integration Contract in `md files/FrontendIntegrationContract.md`. | Guarantees transparent, machine-readable and human-readable API contracts for the future frontend without implementing frontend prematurely; ensures strict screen mapping, SSE live stream wire format, dynamic dataset schema definitions, and evidence explorer contracts are verified. |
| 2026-09-28 | Clean `enforceClientIdentity` to eliminate arbitrary request body mutation. | Removed automatic setting of `req.body.userId`, `req.body.createdById`, and `req.body.requestedById` in auth middleware, preventing Zod `.strict()` schema rejection while strictly enforcing identity verification whenever IDs are explicitly supplied by clients. |
| 2026-09-28 | Unified end-to-end multi-scenario validation and fault isolation. | Verified end-to-end product lifecycle across 3 distinct domain prompts (startups, internships, sponsors). Confirmed that non-fatal source failures (e.g. HTTP 404) isolate gracefully without terminating the workflow run, duplicates are assigned canonical links, conflicting values are preserved with review decisions, and workflow plans adapt dynamically per prompt objective. |
| 2026-09-28 | Comprehensive multi-layer SSRF prevention with DNS preflight. | Hardened `SourceValidator` with static IP classification (RFC 1918, CGNAT, loopback, cloud metadata, IPv6 mapped/compatible) and hostname filtering (rejecting single-label hosts and internal TLDs). Added `validateDnsResolution` to pre-resolve hostnames and block DNS rebinding before outbound HTTP connections in `RobotsPolicyService`. |
| 2026-09-28 | Express security rate-limiting middleware with sliding window. | Implemented `MemoryRateLimiter` protecting authentication routes (15 req/min) against brute-force attacks and workflow planning/execution routes (30 req/min) against queue abuse, returning standard 429 envelopes and `Retry-After` headers. |
| 2026-09-28 | Export path containment guard. | Hardened `ExportRepository.getExportJobForDownload` to verify resolved file paths remain strictly inside `storageDir`, preventing directory traversal attempts. |
| 2026-09-28 | Multi-stage unprivileged Docker production build. | Built Debian-based `backend/Dockerfile` with build caching, devDependency pruning, OpenSSL/Prisma support, curl healthcheck, and unprivileged `node` user execution. |
| 2026-09-28 | Seeded deterministic demo provider architecture governed by `DEMO_MODE=true`. | Allows offline demonstrations and judge evaluations without external API dependency failures. Guarantees no faked results: records are explicitly tagged `_isDemoSimulated: true`, provenance snippets tagged `[SIMULATED PROVENANCE]`, while executing the real data intelligence pipeline (normalization, Zod validation, deduplication, conflict preservation, Prisma persistence, and multi-format exports). When `DEMO_MODE=false`, the server executes live Firecrawl/Gemini extraction. |

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
- Added `20260928160000_phase8_data_quality`: dataset rows now retain `raw_values`, `quality_metadata`, and `verification_status`; `DataQualityReport` persists run/dataset metrics with tenant-scoped foreign keys and indexes.
- `WorkflowExecutionRepository.persistDataset` stores normalized and raw values, quality/verification state, validation issues, duplicate-to-canonical links, deduplication events, quality metrics, and activity events in MySQL. Provenance still links only collected source records observed by enabled tools.
- Workflow `SAVE` output includes the persisted dataset identifiers/counts plus data-quality metrics; run status counters store raw, valid and duplicate totals. The report is also available through the dataset relation in the MySQL model.
- The in-memory pipeline does not claim independent truth verification: tool-backed records are `SOURCE_CITED_UNVERIFIED`; missing evidence is `UNSUPPORTED`; unresolved value disagreements are marked `CONFLICTED` and retained.
- Workflow plan `sourcePolicy.allowedDomains` is optional and defaults to an empty (unrestricted) allowlist. `blockedDomains` takes precedence; rules match exact domains and subdomains. Search result candidates are checked/persisted and excluded from agent-visible search output when disallowed.
- Robots policy uses a bounded native HTTP fetch, parses user-agent groups, allow/disallow specificity, and crawl delay, and caches per origin. Robots fetch errors/HTTP access failures fail closed. Redis Lua sliding-window limits are checked for each actual request attempt, including retries. Timeout/retry settings come from the validated workflow step.
- Source records preserve title/snippet metadata, normalized/canonical URL/hash, lifecycle state, reason/error code, robots result/check time, request attempt count/time, and retrieval time. Full web page bodies are not saved.
- Added `backend/tests/source-governance.test.ts` and MySQL lifecycle/provenance assertions. `.env.example` now includes `SOURCE_ROBOTS_USER_AGENT` and `SOURCE_ROBOTS_TIMEOUT_MS`.
- Added migration `20260928180000_phase12_data_export`: added `file_metadata` JSON column to `export_jobs` table to persist file metadata, size in bytes, row and column counts, and SHA256 checksums.

## 5. Known Bugs / Issues / Verification Limits

- The live integration tests ran successfully against the installed MySQL 9.6 service. MySQL 8.4 remains the version in `docker-compose.yml`; Docker is unavailable here, so that exact service version was not started.
- Redis is not running locally; readiness was not rechecked in this phase. Phase 1 records that `/ready` returns 503 when required services are unavailable.
- Integration tests require `RUN_DATABASE_TESTS=true` and a migrated disposable database. The normal `npm test` run skips these integration checks when that flag is absent.
- No live Firecrawl/LLM request was run during Phase 5; the regular suite uses mocks. Live provider behavior remains unverified until the gated test is deliberately enabled with valid keys. Secrets supplied in chat were not written to files, logs, or this memory; rotate them before ongoing use.
- The Phase 7 migration was deployed to local `aidp_dev`; all seven MySQL integration tests passed against it after Phase 8 migration deployment.
- Cancellation persists immediately and prevents later steps. An active Agent Core operation cannot be force-aborted through the current public `RunParams`; it finishes under source request timeout/retry controls before the worker records cancellation.
- Robots policy is preflighted by this service before Scrape/Interact. Site terms are still policy instructions and are not automatically parsed from legal pages. Search provider calls themselves are not rate-limited per result domain; the per-domain limit gates actual Scrape/Interact attempts.
- Request timeouts bound how long the application waits and abort the provided signal; whether the upstream Firecrawl SDK cancels an already-running remote request depends on SDK support. Rate limiting requires Redis and fails closed if Redis is unavailable.
- Authentication and authorization are fully active as of Phase 13. Passwords are encrypted with bcrypt, access and refresh tokens are managed with JWT and Redis revocation, and client identity anti-spoofing is enforced across all routes.
- No `.env` file exists. `.env.example` contains placeholders.
- The requested remote is configured as `origin`; no credential values are stored in project files.

## 6. Phase 8 — Reference Repository Integration and Pipeline

- Firecrawl is genuinely integrated through the local npm workspace package `@aidp/firecrawl-agent-core` (`packages/firecrawl-agent-core/`), sourced from `githubrepos/web-agent-main/agent-core`. Hash comparison found 54 upstream files, 46 common paths, 43 byte-identical files, and three modified common files (`package.json`, `tsconfig.json`, `src/types.ts`); the local package is renamed/versioned `@aidp/firecrawl-agent-core` and `src/types.ts` includes the configured Firecrawl API URL pass-through. `UPSTREAM.md` records MIT provenance but no upstream commit because the local snapshot has no Git metadata.
- Direct Firecrawl imports are in `backend/src/agent/FirecrawlAgentAdapter.ts` (`createAgent`, `buildFirecrawlToolkit`, core types), `AgentResultNormalizer.ts` (`parseToolResult`, run/step types), `AgentEventMapper.ts` (event type and tool parsing), `types.ts` (event type), and `backend/src/modules/requirements/provider.ts` plus `backend/src/modules/planner/provider.ts` (`resolveModel`, `ModelConfig`). Adapter-specific safety, workflow-step gating, source policy, output schema and platform event/result contracts are platform code, not upstream source.
- The real runtime path is `backend/src/routes/workflows.routes.ts` → `backend/src/modules/workflows/workflow-execution.service.ts` (`RequirementParser.parse` → `WorkflowPlanner.plan` → BullMQ enqueue) → `backend/src/server.ts` (wires `FirecrawlAgentAdapter` into `WorkflowRunner` and starts the worker) → `backend/src/modules/workflows/workflow-runner.ts` (dispatches SEARCH/SCRAPE/INTERACT/EXTRACT steps) → `backend/src/agent/FirecrawlAgentAdapter.ts` (`buildFirecrawlToolkit`, `createAgent`, `agent.stream`, JSON schema, `structured-extraction` skill) → `AgentResultNormalizer` and `AgentEventMapper`. Search, Scrape, and Interact are selected from the validated plan and gated per current step. The normal end-to-end test path uses mocks; `backend/tests/agent.integration.test.ts` is opt-in, and live-provider operation was not verified in this audit.
- Web Research Agent (`githubrepos/web-research-agent-master`, MIT) is not imported. Audited implementations include `utils/web_scraper.py` (`allowed_to_scrape`, `fetch_page`, exponential retries), `utils/get_relevant_urls.py` (`get_relevant_urls`, embedding-based relevance/deduplication), `utils/analyze_query.py` (`analyze_query`), and `tools/result_aggregator_tool.py` (`run_result_aggregator_tool`). The backend independently implements source policy/robots/retry in `backend/src/modules/sources/`; it does not yet use the reference relevance-ranking or query-analysis implementation. Future native TypeScript equivalents can borrow those concepts; the Python modules and their dependencies are not wired into this Node service.
- TheAgentic Browser (`githubrepos/TheAgenticBrowser-main`) is not imported. Its Planner → Browser → Critique loop is visible in `core/agents/planner_agent.py`, `core/agents/browser_agent.py`, `core/agents/critique_agent.py`, and `core/orchestrator.py` (`Orchestrator`). This is architecture reference only. Its Community License Agreement §1.1 excludes competing SaaS/platform/infrastructure or similar online services; do not copy or adapt source code for this product absent explicit legal approval. Any future reliability loop should be designed independently around the product's fixed safe workflow vocabulary and permission controls.
- Anakin (`githubrepos/anakin-master`, AGPL-3.0) is not imported. Its worker/job and persistence patterns are in `server/internal/worker/worker.go` (`Pool`, `Start`, `Submit`, `Drain`), `server/internal/processor/processor.go` (`Processor.ProcessJob`, `processScrapeJob`, `handleFailure`), `server/internal/store/store.go` (`JobStore`) and `server/internal/store/postgres.go`; job states/types are in `server/internal/models/types.go`, HTTP APIs in `server/internal/http/handlers/scraper.go` and `server/internal/http/router/router.go`. The current app independently uses BullMQ and Prisma/MySQL (`backend/src/queue/workflowQueue.ts`, `backend/src/server.ts`, and `backend/src/db/repositories/workflow-execution.repository.ts`). AGPL obligations may apply to network-accessible modified/derivative software; retain as reference-only unless legal review approves reuse.
- No application imports, package dependencies, or source copies from Web Research Agent, TheAgentic Browser, or Anakin were found. Their repositories remain reference-only. Future use means independently implementing suitable ideas in the current TypeScript/MySQL/BullMQ stack, subject to license review.
- Phase 8 implementation completed after that audit. Exact reference-to-application integration report:

| Repository / license | Feature and audited upstream file(s) | Adapted/imported application file(s) | Integration and runtime use |
|---|---|---|---|
| `web-agent-main` / MIT | Agent Core (`agent-core/src/agent.ts`, `src/toolkit.ts`, structured-extraction skill, stream/events/examples) | Vendored package `packages/firecrawl-agent-core/`; adapter `backend/src/agent/FirecrawlAgentAdapter.ts`; normalizer/event mapper in `backend/src/agent/` | Directly vendored/imported previously. Runtime remains requirement → validated workflow plan → BullMQ worker → plan-gated Firecrawl Search/Scrape/Interact → structured result. This phase preserved that as the primary collector; result gating now includes the source selector and source-policy checks. No second agent loop was added. |
| `web-research-agent-master` / MIT | `utils/get_relevant_urls.py:get_relevant_urls`; also audited `utils/web_scraper.py`, `utils/analyze_query.py`, `tools/result_aggregator_tool.py` | New `backend/src/modules/sources/RelevantSourceSelector.ts`; wired in `backend/src/agent/FirecrawlAgentAdapter.ts`; tests in `backend/tests/relevant-source-selector.test.ts` | Ported/adapted relevance ideas (query token scoring, URL/title/snippet relevance, normalized URL dedupe, domain diversity/preference and source cap) to TypeScript. Applied to real Firecrawl Search tool output before the agent sees it. Python modules/dependencies are not imported. Query analysis remains the existing RequirementParser/WorkflowPlanner; scraping, robots, retry, evidence remain existing TypeScript source governance and Firecrawl collection. |
| `TheAgenticBrowser-main` / TheAgentic Community License | `core/agents/planner_agent.py`, `browser_agent.py`, `critique_agent.py`, `core/orchestrator.py` | No source files copied/imported. Existing platform files: `backend/src/modules/planner/planner.service.ts`, `workflow-plan.schema.ts`, `backend/src/agent/FirecrawlAgentAdapter.ts` | Reference only. Existing plan validation/correction and Firecrawl's native agent/tool loop cover reliability needs without its browser code. License §1.1 excludes competing online services/platforms; no port/adaptation was made. Interact remains through Firecrawl's approved tool, not an independent browser executor. |
| `anakin-master` / AGPL-3.0 | `server/internal/worker/worker.go`, `processor/processor.go`, `store/store.go`, `models/types.go`, HTTP handlers/router | No source files copied/imported. Existing platform files: `backend/src/queue/workflowQueue.ts`, `backend/src/server.ts`, `backend/src/modules/workflows/workflow-runner.ts`, `backend/src/db/repositories/workflow-execution.repository.ts` | Reference only. BullMQ worker concurrency, persisted run/step states, bounded retries, cancellation, dataset persistence and activity history are already implemented natively with Prisma/MySQL. Python/Go runtime adaptation was unnecessary; AGPL code was not reused. |

- License controls: Firecrawl and Web Research Agent source inspected as MIT; Web Research concepts were reimplemented in first-party TypeScript. TheAgentic Community License restriction and AGPL-3.0 status for Anakin are respected per `Rules.md`; both remain reference-only. Exact license files were read from the repository snapshots (the four workspace LICENSE paths currently show pre-existing deletions; their committed content remains in Git history).
- Pipeline modules: `backend/src/modules/data-intelligence/NormalizationService.ts`, `ValidationService.ts`, `DeduplicationService.ts`, `EntityResolutionService.ts`, and `DataQualityService.ts`, with shared provenance/conflict types and conservative merge utilities. `WorkflowRunner` invokes the pipeline for transform/validate/dedupe/merge steps and enforces it again at SAVE so persisted data always passes through it.
- Coverage includes aliases, whitespace/empty values, URL/date/phone/currency/country normalization, type/required/format/enum/country validation, exact/normalized/URL duplicates, conservative entity resolution, review decisions, conflicting-value retention, field/record verification labels and data-quality counts. No semantic verification is claimed.

## 7. Final Architecture & Known Limitations

### Final System Architecture
```
Natural Language Input ("Find 100 AI startups in India...")
   │
   ▼
[Requirement Parsing] (RequirementParserService + Provider)
   │  → Validates schema, entity type, target count, geography, fields, constraints
   ▼
[Autonomous Workflow Planner] (WorkflowPlannerService + Provider)
   │  → Synthesizes versioned DAG: SEARCH → SCRAPE → EXTRACT → TRANSFORM → VALIDATE → DEDUPLICATE → SAVE
   ▼
[Autonomous Execution Engine] (WorkflowRunner + AgentAdapter)
   │  ├── DEMO_MODE=false: FirecrawlAgentAdapter (Search/Scrape/Interact) + RelevantSourceSelector + RobotsPolicy
   │  └── DEMO_MODE=true:  DemoAgentAdapter (Deterministic high-fidelity seed data, provenance, 404 tolerance)
   ▼
[Data Intelligence Pipeline]
   │  ├── NormalizationService: Strips noise, normalizes URLs, dates, funding, locations
   │  ├── ValidationService: Zod rule checking, flags missing required fields or invalid formats
   │  ├── DeduplicationService: Exact & normalized matching; links duplicates to canonical entity
   │  ├── EntityResolutionService: Resolves cross-source entity attributes
   │  └── DataQualityService: Preserves conflicting field values; computes quality metrics
   ▼
[Relational Persistence Layer] (Prisma 6.12 + MySQL)
   │  ├── Workspaces, Users, WorkflowPlans, WorkflowRuns, WorkflowSteps, ActivityEvents
   │  └── Datasets, DatasetColumns, DatasetRows, Sources, SourceEvidence, Conflicts
   ▼
[Live Monitoring & Provenance]
   │  ├── Server-Sent Events (SSE): GET /api/v1/runs/:id/events (EventSource compatible + Redis Pub/Sub)
   │  └── Provenance Explorer: GET /api/v1/rows/:id/evidence & /sources (granular field-level citations)
   ▼
[Data Export Engine] (ExportService + Format Writers)
   └── Asynchronous streaming in CSV (RFC 4180), JSON (valid array), and XLSX (ExcelJS)
```

### Known Limitations
1. **Live External API Quotas & Rate Limits:** When `DEMO_MODE=false`, execution relies on external Firecrawl API rate limits and Gemini LLM token quotas.
2. **Strict Fail-Closed Robots.txt:** In live mode, destinations whose robots.txt cannot be reached or explicitly disallow scraping fail closed to guarantee compliance.
3. **Cooperative Step Cancellation:** Run cancellation takes effect at workflow step boundaries; an active in-flight HTTP request completes under its timeout limit before the runner halts.
4. **Demo Simulation Transparency:** In `DEMO_MODE=true`, data is not fetched from the live web. Every simulated record is explicitly tagged with `_isDemoSimulated: true` and provenance snippets tagged `[SIMULATED PROVENANCE]` to maintain transparency while preserving the identical contract.
5. **Database Multi-Container Requirements:** Running with full cross-process Redis Pub/Sub requires MySQL 8.4 and Redis 7 (provided via `docker-compose.yml`).

## 8. Environment Variables / How to Run / Commands

### Environment Variables
| Variable | Description | Required | Default |
|---|---|---|---|
| `DEMO_MODE` | Enable deterministic judge demo mode (bypasses mandatory external API keys) | No | `false` |
| `APP_ENV` | Environment name (`development`, `test`, `production`) | No | `development` |
| `PORT` | HTTP server port | No | `3000` |
| `DATABASE_URL` | MySQL connection string (`mysql://user:pass@host:port/db`) | Yes (or MYSQL_* vars) | - |
| `REDIS_URL` | Redis connection URL (`redis://localhost:6379`) | Yes (in prod/worker) | `redis://localhost:6379` |
| `JWT_ACCESS_SECRET` | Secret key for signing access tokens (min 32 chars) | Yes | - |
| `JWT_REFRESH_SECRET` | Secret key for signing refresh tokens (min 32 chars) | Yes | - |
| `FIRECRAWL_API_KEY` | Firecrawl API key (optional if DEMO_MODE=true) | Conditional | - |
| `FIRECRAWL_BASE_URL` | Custom Firecrawl API URL | No | `https://api.firecrawl.dev` |
| `LLM_PROVIDER` | LLM model provider (`google`, `openai`, `anthropic`) | No | `google` |
| `LLM_MODEL_ID` | Model name | No | `gemini-2.5-flash` |
| `GEMINI_API_KEY` | Google Gemini API key (optional if DEMO_MODE=true) | Conditional | - |
| `LOG_LEVEL` | Pino logging level (`debug`, `info`, `warn`, `error`) | No | `info` |

### How to Run Locally
```bash
# 1. Clone & copy environment config
Copy-Item .env.example .env

# 2. Start backing services (MySQL + Redis)
docker compose up -d

# 3. Install dependencies across workspaces
npm install

# 4. Generate Prisma client & apply database migrations
npm run db:generate
npm run db:migrate --workspace @aidp/backend -- --name init

# 5. Seed initial development workspace
npm run db:seed

# 6. Start development server
npm run dev
```

### Demonstration Commands (Judge Scenarios)
```bash
# Run Scenario 1 (100 Indian AI Startups founded after 2020)
npm run demo

# Run Scenario 2 (Software Engineering Jobs in India)
npm run demo -- --scenario 2

# Run Scenario 3 (College Hackathon Technology Sponsors)
npm run demo -- --scenario 3

# Run all 3 demonstration scenarios sequentially
npm run demo:all
```

### Test & Build Commands
```bash
# Run unit and end-to-end test suite (213 tests across 18 test suites)
npm test

# Run tests with database integration (requires local MySQL)
npm run test:db

# Run TypeScript typecheck across all workspaces
npm run typecheck

# Run ESLint linter
npm run lint

# Generate OpenAPI 3.1.0 documentation (backend/docs/openapi.json)
npm run docs:generate --workspace @aidp/backend

# Production build
npm run build
```

## 9. Frontend Integration Notes

The frontend integration contract is fully documented in `md files/FrontendIntegrationContract.md` and machine-readable via `backend/docs/openapi.json` (`GET /api/v1/openapi.json`). Key architectural details for UI developers:

1. **Authentication & Authorization:** All API requests except `/api/v1/auth/*` and `/health` require `Authorization: Bearer <accessToken>`. Tokens refresh via `POST /api/v1/auth/refresh`. Workspace isolation is enforced via workspace ID headers or routes.
2. **8 Target Screens Supported:**
   - Screen 1: New Research Task (`POST /api/v1/requirements/parse`)
   - Screen 2: Workflow Preview (`POST /api/v1/workflows/plan`)
   - Screen 3: Workflow Running (`POST /api/v1/workflows/execute`, live monitoring via SSE)
   - Screen 4: Workflow History (`GET /api/v1/workflows`, `GET /api/v1/runs/:id`)
   - Screen 5: Dataset Explorer (`GET /api/v1/datasets/:id/rows` with dynamic column schema, sorting, and filtering)
   - Screen 6: Source & Evidence Explorer (`GET /api/v1/datasets/:id/sources`, `GET /api/v1/rows/:id/evidence`)
   - Screen 7: Export Dialog (`POST /api/v1/datasets/:id/exports`, `GET /api/v1/exports/:id/download`)
   - Screen 8: Activity Log (`GET /api/v1/runs/:id/activity`)
3. **Live SSE Wire Protocol:** Frontend connects via standard `EventSource('/api/v1/runs/:id/events')`. Replays past events upon connection, then streams live canonical actions (`SOURCE_DISCOVERY_STARTED`, `SOURCE_DISCOVERED`, `SCRAPE_STARTED`, `SCRAPE_COMPLETED`, `EXTRACTION_STARTED`, `RECORDS_EXTRACTED`, `VALIDATION_COMPLETED`, `DEDUPLICATION_COMPLETED`, `DATASET_CREATED`, `RUN_COMPLETED`, `RUN_FAILED`). Keepalive comment `:keepalive` sent every 15s.
4. **Dynamic Dataset Schemas & Querying:** Datasets have registered relational column types (`string`, `number`, `url`, `email`, `date`, `boolean`). Rows are returned with `values` JSON and `rawValues`. Querying supports text search, `page`, `limit`, `sortField`, `sortOrder`, `validOnly=true`, `includeDuplicates=false`, `verificationStatus`, `minConfidence`, and `fieldFilters`.
5. **Granular Provenance & Explainability:** Rows link to cited sources. `GET /api/v1/rows/:id/evidence` returns per-field citations with snippet evidence and `isVerified` flags. Conflicting values discovered across multiple sources are preserved in `row.conflicts`.

## 10. Last Session Summary

Final Phase (Demo Readiness) completed. The platform is ready for demonstration to judges:
- **3 Polished Demonstration Scenarios:**
  - **Scenario 1:** "Find 100 AI startups in India founded after 2020 with company name, founder, website, funding and location." (106 records extracted, 105 valid, 3 duplicates detected, 3 conflicts preserved, 19 sources with 1 broken 404 test source).
  - **Scenario 2:** "Find software engineering jobs in India and collect company, role, location, salary, application URL and source." (32 records, 2 duplicates, 2 salary conflicts, 7 sources).
  - **Scenario 3:** "Find potential technology sponsors for a college hackathon and collect company name, industry, website and contact page." (27 records, 2 duplicates, 1 conflict, 6 sources).
- **Seeded Demo Provider Architecture & Flag:**
  - Added configuration flag `DEMO_MODE=true` in `backend/src/config/env.ts`.
  - When `DEMO_MODE=true`: External API key checks are bypassed; `DemoRequirementProvider`, `DemoWorkflowPlanProvider`, and `DemoAgentAdapter` execute deterministic high-fidelity workflows. Records are explicitly labeled `_isDemoSimulated: true`, provenance tagged `[SIMULATED PROVENANCE]`, and results are never faked. The identical data contract, Zod validation, normalization, deduplication, conflict preservation, Prisma persistence, and multi-format exports are executed.
  - When `DEMO_MODE=false`: The real pipeline runs live Firecrawl search/scraping and Gemini structured extraction.
- **Interactive Terminal Demo Runner:**
  - Implemented `backend/src/scripts/run-demo.ts` with colorful ANSI output walking through all 6 stages (Requirement Parsing, Workflow DAG Plan, Step Execution Progress, Discovered Sources, Dataset & Quality Metrics Preview Table, and Multi-Format CSV/JSON/XLSX Exports).
  - Added `npm run demo` and `npm run demo:all` npm scripts.
- **Documentation & Verification:**
  - Created `md files/DemoScenariosAndApiGuide.md` providing end-to-end curl commands and JSON payloads for evaluators.
  - Added 7 dedicated scenario integration tests in `backend/tests/demo-scenarios.test.ts`.
  - Verified 213 passing tests across 18 test suites, 0 ESLint errors/warnings, clean TypeScript typecheck (`tsc --noEmit`), and successful production build (`tsc -p tsconfig.build.json`).

## 11. PirateAgentUI Frontend Integration

The existing Next.js frontend (`PirateAgentUI`) has been completely connected to the backend API without altering its visual theme, styling, components, or layout:

- **Authentication & Session (`PirateAgentUI/lib/auth.tsx`):**
  - Implemented `AuthProvider` with reactive state for `user`, `loading`, `login()`, `register()`, `logout()`, and `refreshUser()`.
  - Persists JWT tokens to `localStorage` (`pirateagent:access_token`, `pirateagent:refresh_token`).
  - Automatically fetches `/auth/me` on mount to restore active user sessions and workspace context.
  - Login (`/login`) and Register (`/signup`) routes connected to real backend endpoints with user-facing validation errors.
- **Central API Client (`PirateAgentUI/lib/api.ts`):**
  - Unified HTTP helper with automatic `Authorization: Bearer <token>` injection.
  - Automatic single-retry token refresh on 401 Unauthorized responses.
  - Full TypeScript types for requests, responses, pagination, and errors (`ApiError`).
- **Real-Time SSE Execution Streaming (`PirateAgentUI/hooks/use-sse.ts`):**
  - Connects to `/api/v1/runs/:id/events` with automatic backoff reconnection and token query authentication.
  - Replays historical execution events on connect, receives real-time progress, step updates, logs, and stage transitions.
- **Full Page & Feature Wiring:**
  - **Dashboard (`/dashboard`):** Real-time aggregate metrics, recent workflows, and recent datasets fetched via `useApi` hooks with skeleton loading states.
  - **New Research Mission (`/dashboard/research/new`):**
    - Calls `POST /api/v1/requirements/parse` for natural language requirement extraction and data contract generation.
    - Displays interactive plan preview with step DAG and schema confirmation.
    - Launches execution via `POST /api/v1/workflows/execute` and redirects directly to live run tracking.
  - **Live Workflow Execution (`/dashboard/workflows/live`):**
    - Real-time SSE event consumption replacing all client simulations.
    - Dynamic progress bars, step stage states, live log terminal, discovered sources count, and extracted record counters.
    - Automatic redirection to dataset view upon completion.
  - **Workflows Explorer (`/dashboard/workflows` and `/dashboard/workflows/:id`):** Real workflow list with client-side status filtering, detail view with execution DAG and step activity.
  - **Datasets Explorer (`/dashboard/datasets` and `/dashboard/datasets/:id`):** Real datasets list, dynamic column schema, server-side pagination, search, sort, and record evidence drawer (`GET /api/v1/datasets/:id/rows/:rowId/evidence`).
  - **Export System (`components/dataset/export-menu.tsx`):** Triggers backend exports via `POST /api/v1/datasets/:id/exports` (CSV, JSON, Excel) and automatically downloads generated files via `GET /api/v1/exports/:id/download`.
  - **Sources, History, Activity, and Settings:** All wired to backend endpoints with workspace context.
- **Zero Mock Dependencies:** All imports from `mock-data.ts` removed across active application pages.
- **Verified Production Builds:**
  - Backend: `npm run build` (`tsc -p tsconfig.build.json`) exits with 0 errors.
  - Frontend: `npm run build:frontend` (`next build`) exits with 0 errors across all 15 static/dynamic routes.
  - Backend Tests: 213 tests passing across 18 test suites.

## 12. Final End-to-End System Audit (Phases O → T)

- **Phase O (Real Workflow Execution Chain):** Verified the unbroken real runtime pipeline:
  `User Prompt` → `RequirementParserService` → `DataContract` → `WorkflowPlannerService` → `WorkflowPlan DAG` → `WorkflowExecutionService` → `BullMQ / Redis Queue` → `WorkflowRunner` → `FirecrawlAgentAdapter (@aidp/firecrawl-agent-core)` → `Search / Scrape / Interact` → `Structured Extraction (Zod Schema)` → `Data Intelligence Pipeline (Normalize / Validate / Dedupe / Quality)` → `Prisma ORM` → `MySQL Database` → `Dataset & Provenance Evidence` → `Real API` → `PirateAgentUI Frontend`. No client simulation remains.
- **Phase P (Repository Integration Verification):**
  - `web-agent-main`: Firecrawl agent core genuinely vendored into `@aidp/firecrawl-agent-core` (`packages/firecrawl-agent-core/`), wrapped by `FirecrawlAgentAdapter.ts`, `AgentResultNormalizer.ts`, `AgentEventMapper.ts`.
  - `web-research-agent-master`: Relevance scoring, source quality filtering, domain diversity, and URL deduplication ported to native TypeScript in `RelevantSourceSelector.ts` and source governance modules (`SourcePolicyService`, `RobotsPolicyService`, `RateLimitService`, `RetryPolicy`).
  - `TheAgenticBrowser-main`: Deterministic DAG planner concepts implemented natively in `WorkflowPlannerService` and `workflow-plan.schema.ts`. No proprietary upstream code copied (respecting Community License §1.1).
  - `anakin-master`: Job queueing, worker pools, step state persistence, and execution tracking implemented natively in `workflowQueue.ts`, `workflow-runner.ts`, and `workflow-execution.repository.ts` with BullMQ/MySQL, avoiding AGPL obligations.
- **Phase Q (Repository Audit & Deletion Safety):**
  - Comprehensive scan performed: Zero imports, zero package dependencies, zero script references to `githubrepos` exist in application code.
  - Deletion of `D:\AI-Powerd Data Intelligence\githubrepos` is 100% safe and will NOT affect builds, tests, or runtime.
  - Status: `githubrepos` is preserved intact pending explicit user confirmation `DELETE REPOSITORIES`.
- **Phase R (Frontend/Backend 25 Contract Actions):**
  - All 25 contracts verified against real backend routes and schemas: Register, Login, Logout, Dashboard load, Research create, Parse analysis, Plan generation, Workflow execution, SSE monitor, History, Dataset open, Search, Filter, Sort, Paginate, Sources open, Evidence drawer, Activity feed, Profile, Preferences, Appearance, Multi-format exports (CSV/JSON/XLSX), Failure handling, 401 Unauthorized handling, and Session refresh.
- **Phase S (Build & Quality Check):**
  - Backend Vitest: 213 passing tests across 18 test suites (0 failures).
  - Backend Typecheck: `tsc --noEmit` across `@aidp/firecrawl-agent-core` and `@aidp/backend` passes with 0 errors.
  - Backend Lint: `eslint backend/src backend/tests` passes with 0 errors, 0 warnings.
  - Backend Build: `tsc -p tsconfig.build.json` passes with 0 errors.
  - Frontend Lint: `eslint app components lib hooks` in `PirateAgentUI` passes with 0 errors, 0 warnings.
  - Frontend Build: Next.js 14.2.35 `next build` passes with 0 errors across 15 routes.
- **Phase T (UI Preservation Audit):**
  - Verified 100% preservation of PirateAgentUI visual theme, CSS variables, pirate-themed icons, fonts, responsive layout, and component aesthetics. No redesign introduced.

