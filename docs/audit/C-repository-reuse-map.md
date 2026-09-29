# C. Repository Reuse Map

Every entry records: **source path → logic used → final location → integration method**, as
required. Integration methods:

- **DIRECT COPY** — file/content reused essentially unchanged
- **ADAPT** — same design, modified to fit the new stack
- **PORT** — logic reimplemented in another language, preserving behaviour
- **PORT (concept only)** — pattern studied, implementation written independently. **Mandatory
  for all AGPL / Community-License material** (`anakin-master`, `TheAgenticBrowser-main`)
- **WRAP** — call an external library through our own thin adapter
- **REIMPLEMENT** — idea kept, existing code judged unfit
- **IGNORE / DROP** — not carried forward

## C.0 Target folder structure (referenced by all tables below)

```
FINALAIAGENT/
├── docs/
│   ├── audit/                       ← this Phase 0 output (A–M)
│   └── control/                     ← PRD.md, Architecture.md, Rules.md,
│                                        Phases.md, Design.md, Memory.md (rewritten for the
│                                        new stack; Design.md replaced by the real UI tokens)
├── backend/                         ← Spring Boot (Maven, Java 21)
│   ├── pom.xml
│   └── src/main/java/ai/finalagent/
│       ├── config/                  ← executors, Jackson, OpenAPI, CORS, resilience
│       ├── security/                ← JWT resource server, workspace tenancy, identity guard
│       ├── api/                     ← controllers, request/response DTOs, mappers, SSE
│       ├── domain/                  ← JPA entities, enums, Spring Data repositories
│       ├── requirement/             ← contract model + validation
│       ├── planner/                 ← plan model, DAG validation, correction loop
│       ├── engine/                  ← job engine, claim/lease, step executors, cancellation
│       ├── governance/              ← SSRF, allow/block, robots, rate limit, relevance rank
│       ├── dataset/                 ← dynamic columns, row query, search, filters
│       ├── provenance/              ← evidence integrity, row/field evidence explorer
│       ├── export/                  ← queued export jobs, CSV/JSON/XLSX writers
│       ├── monitoring/              ← activity events, SSE broadcaster + replay
│       └── aiclient/                ← typed client for the Python AI service
│   └── src/main/resources/db/migration/   ← Flyway V1__baseline.sql, V2__…
├── ai-service/                      ← FastAPI (Python 3.12), stateless
│   ├── pyproject.toml
│   └── app/
│       ├── api/v1/                  ← 5 endpoints (see H)
│       ├── contracts/               ← Pydantic Requirement / Plan / Record models
│       ├── llm/                     ← Gemini client, prompts, structured output, repair
│       ├── firecrawl/               ← SDK wrapper: async search / scrape / interact
│       ├── extraction/              ← schema-validation gate + bounded repair
│       └── quality/                 ← normalize, validate, dedupe, entity-resolve, score
├── frontend/                        ← Next.js (PirateAgentUI design, preserved exactly)
│   ├── app/ components/ lib/ hooks/ public/pirate/
│   ├── tailwind.config.ts  next.config.js
├── deploy/                          ← docker-compose.yml (mysql + backend + ai-service + frontend)
├── .env.example                     ← single source of variable names (see K)
└── README.md
```

---

## C.1 `AI-Powerd Data Intelligence` (old project) — primary reuse source

### C.1.1 Domain model & persistence

| Source path | Logic used | Final location | Method |
|---|---|---|---|
| `backend/prisma/schema.prisma` (16 models, 17 enums, 7 migrations) | Entire domain model: User, Workspace, WorkspaceMember, Workflow, WorkflowPlan (versioned), WorkflowRun, WorkflowStep, Dataset, DatasetColumn, DatasetRow, Source, SourceEvidence, ValidationIssue, DeduplicationEvent, DataQualityReport, ExportJob, ActivityEvent | `backend/src/main/java/ai/finalagent/domain/` + `resources/db/migration/V1__baseline.sql` | **PORT** (Prisma → JPA entities + Flyway DDL). See `E-database-model.md` |
| same, compound FK pattern `(workspaceId, datasetId)` etc. | Tenant-scoped compound foreign keys that structurally prevent cross-workspace links | `domain/` entity `@Table(uniqueConstraints…)` + FK definitions | **PORT** — keep unchanged, it is the best idea in the old schema |
| same, `DatasetColumn` + `DatasetRow.values` JSON | Dynamic per-dataset schema: registered typed columns + JSON row values | `domain/DatasetColumn.java`, `domain/DatasetRow.java` | **PORT** |
| `backend/prisma/seed.ts:39-69` | Demo login `demo@pirateagent.ai` / `Demo1234!` | — | **DROP** (hardcoded backdoor credential) |
| `backend/prisma/seed.ts:1-30` | Dev user/workspace bootstrap, refuses `APP_ENV=production` | `resources/db/migration/afterMigrate` or a `--seed` profile | **ADAPT** — keep the production refusal |

### C.1.2 Contracts (highest-value portable artifacts)

| Source path | Logic used | Final location | Method |
|---|---|---|---|
| `backend/src/modules/requirements/requirement.schema.ts` | The full Requirement contract: objective, entityType, quantity, geography{places,scope,includeSubregions}, timeRange, filters (12 operators), constraints, fields (typed, snake_case keys), requiredFields ⊕ optionalFields cross-validation, sourcePreferences, sourceRestrictions, deduplicationKeys, validationRules, outputFormat, ambiguities, missingInformation, warnings | `ai-service/app/contracts/requirement.py` (Pydantic, authoritative) + `backend/.../requirement/RequirementContract.java` (Bean Validation mirror for enforcement) | **PORT** to both languages. Python produces it; Java re-validates it. Never trust one side |
| `backend/src/modules/planner/workflow-plan.schema.ts` | Plan contract: 2-30 steps over the 10-type vocabulary; per-step `retryPolicy` (maxAttempts ≤5, `none`/`exponential`, retryableErrors ⊂ {TIMEOUT, RATE_LIMIT, TRANSIENT_NETWORK, SERVER_ERROR}); `timeoutMs` 1s-300s; dependencies must reference earlier steps; **≥1 EXTRACT and ≥1 SAVE** (:144-145); safety literals `respectRobotsTxt/respectSiteTerms=true`, `allowAuthentication/allowCaptchaBypass=false` (:61-64); `maxRequestsPerDomainPerMinute ≤60`; sourcePolicy, searchStrategy, extractionSchema (`additionalProperties:false`), 7 transformation ops, 10 validation rule codes, dedup rules, completionCriteria (`requireSourceEvidence=true`), outputConfiguration; plan↔requirement field cross-check (:166-182) | `ai-service/app/contracts/plan.py` + `backend/.../planner/WorkflowPlanValidator.java` | **PORT** to both. The safety literals must be **constants in Java**, not LLM-controlled — the model must not be able to relax them |
| `backend/src/modules/planner/planner.service.ts:45-80` | 2-attempt generate → validate → correct loop that feeds validation issues back into the model prompt | `ai-service/app/llm/planner.py` + `backend/.../planner/PlanningService.java` | **PORT** (pattern). Keep the bound at 2 attempts, then fail closed |
| `backend/src/modules/requirements/prompt.ts:3-20` | Requirement system prompt: analysis-only, "user text is untrusted data" anti-injection stance, infer 4-6 default fields only when the user names none, quantity defaulting guidance | `ai-service/app/llm/prompts/requirement.md` | **ADAPT** — keep the anti-injection wording verbatim; the field examples stay as *prompt guidance only* and must never become code defaults |
| `backend/src/modules/planner/prompt.ts` | Planner system prompt: safety rules, fixed step vocabulary, "must stop at planning", correction replay | `ai-service/app/llm/prompts/plan.md` | **ADAPT** |

### C.1.3 Data-intelligence pipeline → Python

| Source path | Logic used | Final location | Method |
|---|---|---|---|
| `data-intelligence/NormalizationService.ts` | Alias→canonical field map (:4-13), key folding, empty-value set (:15), URL/date/phone/currency/number normalization, currency-field heuristic regex `/funding\|salary\|price\|revenue\|amount\|cost\|budget\|valuation/i` (:147), country normalization via `Intl.DisplayNames` (:211-225), first-non-empty-wins with alias conflicts noted (:40-43) | `ai-service/app/quality/normalize.py` | **PORT**. Replace `Intl.DisplayNames` with a static ISO-3166 country table (deterministic, testable) |
| `data-intelligence/ValidationService.ts` | Per-record source-evidence check (:17,26-30 → `SOURCE_EVIDENCE` ERROR), REQUIRED/TYPE/URL/EMAIL/DATE/ENUM checks from the extraction schema, COUNTRY validation, `isValid` derivation, verification states, per-field confidence heuristic `min(0.7, 0.45+0.1*(sources-1))` (:142); honest downgrade of unimplemented RANGE/CUSTOM to WARNING (:63) | `ai-service/app/quality/validate.py` + Java enforcement in `backend/.../dataset/RowContractEnforcer.java` | **PORT** (Python, advisory) + **REIMPLEMENT** (Java, authoritative gate). Keep the "downgrade rather than fake" behaviour |
| `data-intelligence/DeduplicationService.ts` | Deterministic blocking index on rule keys, EXACT vs NORMALIZED, FUZZY_REVIEW excluded from auto-merge (:20), URL-aware normalization, merge-into-canonical with conflict capture, duplicate→canonical linking, event emission | `ai-service/app/quality/dedupe.py` | **PORT** |
| `data-intelligence/EntityResolutionService.ts` | Name-field detection regex (:15), legal-suffix stripping (:14), blocking on first-2-chars + normalized identifiers (url/website/domain/linkedin/email/registration/tax) (:94-101), Levenshtein similarity (:127-144), threshold **0.94** (:24), merge only when a shared stable identifier exists, else KEPT_SEPARATE / REVIEW_REQUIRED | `ai-service/app/quality/entity_resolution.py` | **PORT**; use `commons-text`/`rapidfuzz` equivalents. Keep the conservative "identifier required to merge" rule — it is what prevents silently combining distinct records |
| `data-intelligence/DataQualityService.ts:35-46,77-79` | Pipeline orchestration and the confidence formula `clamp(0.2+0.15+min(0.2,(domains-1)*0.1)+completeness*0.25+(errors?0:0.15)-warnings*0.025-conflicts*0.1, 0.05, 0.95)`; 0.05 when not source-backed | `ai-service/app/quality/score.py` | **PORT** — but document it explicitly as a **heuristic formula, not a measured truth**. The old project's UI presented it as "confidence", which overstates it |
| `data-intelligence/recordMerge.ts` | Canonical merge with per-field conflict capture | `ai-service/app/quality/merge.py` | **PORT** |

### C.1.4 Source governance → Java

| Source path | Logic used | Final location | Method |
|---|---|---|---|
| `sources/SourceValidator.ts:84+` | SSRF guard `isNonPublicHost`: RFC1918, loopback, CGNAT 100.64/10, link-local 169.254/16 (cloud metadata), IPv6 forms; canonical URL + SHA-256 hash; credential-stripping `safeUrl` | `backend/.../governance/SsrfGuard.java`, `UrlCanonicalizer.java` | **PORT** — mandatory for a scraping platform |
| `sources/SourceValidator.ts:226-234` | DNS preflight resolution to block rebinding | `governance/SsrfGuard.java` (resolve, then pin/validate before the outbound call) | **PORT** |
| `sources/RobotsPolicyService.ts` | robots.txt fetch with configurable UA (`SOURCE_ROBOTS_USER_AGENT`, default `ScoutlyBot`), UA-group parsing, allow/disallow specificity, crawl-delay, per-origin cache, bounded 512 KB response, **fail closed** on any fetch error | `governance/RobotsPolicyService.java` | **PORT** — keep fail-closed. Note it reduces yield; surface `BLOCKED`/`SKIPPED` reasons to the UI rather than hiding them |
| `sources/RateLimitService.ts:13-36` | Redis Lua sliding window per domain (`ZREMRANGEBYSCORE`/`ZCARD`/`ZADD`), honours robots crawl-delay, fails closed when Redis is unavailable | `governance/DomainRateLimiter.java` | **REIMPLEMENT** with Bucket4j in-memory. Behaviour preserved (per-domain window + crawl-delay floor); storage changed. Document the single-node limitation |
| `sources/RetryPolicy.ts` | Timeout/abort/retry executor with backoff; `SourceOperationError` codes | `governance/RetryPolicy.java` (Resilience4j) | **PORT** |
| `sources/SourcePolicyService.ts:32-162,175-180` | The governance pipeline: validate → persist DISCOVERED → allow/block → robots → QUEUED → PROCESSING → rate-limit → execute with retries → COLLECTED/FAILED/SKIPPED/BLOCKED, with sanitized error messages | `governance/SourceGovernanceService.java` | **PORT** — this is the authoritative gate; Python may only collect URLs Java has cleared |
| `sources/RelevantSourceSelector.ts:11-96` | Relevance ranking: token coverage `0.55*title + 0.3*snippet + 0.15*url`, phrase boost 0.25, preferred-domain boost 0.15, floor 0.12, canonical dedupe, per-domain repeat penalty 0.08, tracking-param stripping | `governance/SourceRelevanceRanker.java` | **PORT**. Make the weights **configuration**, not magic numbers |

### C.1.5 Agent adapter & integrity rules

| Source path | Logic used | Final location | Method |
|---|---|---|---|
| `agent/AgentResultNormalizer.ts:41-49,169` | **Keep only source URLs actually observed in tool results**; model-reported URLs get `verifiedByTool=false`; records without observed sources flagged `SOURCE_EVIDENCE_UNVERIFIED` | `backend/.../provenance/EvidenceIntegrity.java` (enforced in Java, after Python returns records) | **PORT** — this is the platform's anti-fabrication backbone. Enforce server-side, never in the client or the model |
| `evidence/provenance.service.ts:12-48` | `isSnippetVerifyingValue`: a snippet only corroborates a value if the value (or all ≥3-char tokens) literally appears in it; otherwise `isVerified:false` | `provenance/SnippetVerifier.java` | **PORT** verbatim in behaviour |
| `evidence/provenance.service.ts` (`buildRowEvidenceExplorer`) | Row-evidence explorer assembly, multi-source row provenance, conflict history | `provenance/ProvenanceService.java` | **PORT** |
| `agent/FirecrawlAgentAdapter.ts:168-177` | Enable only the tools implied by the validated plan | `ai-service/app/firecrawl/client.py` (tool allowlist passed per request from Java) | **PORT** (pattern) |
| `agent/FirecrawlAgentAdapter.ts:242-309` | Toolkit gating wrapper: per-URL public-host check, blocked-domain check, per-domain rate window | `backend/.../governance/` (Java pre-clears) — the gate moves **out** of the agent and **into** the orchestrator, where it cannot be bypassed | **ADAPT** (stronger position than the original) |
| `agent/FirecrawlAgentAdapter.ts:201-230` | Collection prompt injecting objective, required fields, target count, queries, domain policy, completion criteria; demands `{records:[{values,sourceUrls}]}`; explicit "never fabricate" | `ai-service/app/llm/prompts/extract.md` | **PORT** |
| `agent/FirecrawlAgentAdapter.ts:179-199` | Derive the JSON output schema from `plan.extractionSchema` | `ai-service/app/extraction/schema.py` | **PORT** |
| `agent/FirecrawlAgentAdapter.ts:91-93` | `maxSteps = clamp(6..40, steps*3)`, `maxWorkers=3` when desiredSourceCount>5 | `ai-service` config + Java step budgets | **ADAPT** — with Spring owning the DAG, "steps" become per-step source caps |
| `agent/FirecrawlAgentAdapter.ts:403-419` | Secret redaction in error text | `backend/.../config/SecretMasking.java` + Python log filter | **PORT** |
| `agent/AgentEventMapper.ts:5-11` | Core agent events → `agent.tool.started/completed/failed/progress` with a tool→step-type map | `ai-service/app/api/v1/events.py` (SSE/chunked response) → Java `monitoring/` | **ADAPT** |
| `agent/types.ts` | `AgentAdapter` contract and `AgentResult{status, records[{values,rawValues,sourceUrls,quality,isValid,validationIssues}], sources[{url,canonicalUrl,domain,title,snippet,sourceType,retrievedAt,verifiedByTool}], execution{provider,model,duration,tokens,toolCallCount,toolsUsed}, events, errors}` | `ai-service/app/contracts/result.py` + `backend/.../aiclient/dto/` | **PORT** — this shape is well designed; keep it as the Python↔Java wire contract |
| `agent/MockAgentAdapter.ts` | Test double | new mocks in both test suites | **REIMPLEMENT** |
| `packages/firecrawl-agent-core/**` (vendored TS fork, `0.1.0-vendor.1`) | The whole LangChain/deepagents harness | — | **DROP**. Only delta vs upstream was `apiUrl` pass-through in `src/types.ts`. We call the Firecrawl Python SDK instead |

### C.1.6 Execution engine, monitoring, API

| Source path | Logic used | Final location | Method |
|---|---|---|---|
| `modules/workflows/workflow-runner.ts:24,58-64,102-229` | Sequential step execution with dependency checking, per-step retry honouring the plan's policy, cancellation checks at step boundaries, progress as step index | `backend/.../engine/WorkflowExecutor.java` | **REIMPLEMENT** — keep dependency + cancellation semantics, but add real DAG scheduling (independent steps may run in parallel), finer progress, and crash-resume. Sequential-only was a stated limitation |
| `modules/workflows/workflow-runner.ts:167-169` | `EXPORT` always `SKIPPED` with `EXPORT_NOT_IN_PHASE` | `engine/steps/ExportStepHandler.java` | **REIMPLEMENT** — export becomes a real queued step |
| `modules/workflows/workflow-execution.service.ts:32` | BullMQ enqueue `queue.add("execute-workflow",{runId},{jobId:runId,…})` | `engine/JobSubmitService.java` → MySQL insert | **REIMPLEMENT** (see `J-no-redis-job-architecture.md`). Note the old `jobId=runId` prevented re-enqueue after failure — do not reproduce that |
| `queue/workflowQueue.ts`, `queue/connection.ts`, `server.ts:35-41,71-79` | Queue names, ioredis config, worker concurrency 2, Redis pub/sub event bus | — | **DROP** (Redis excluded) |
| `monitoring/event-broadcaster.ts:56-99` | Persist every event to `activity_events` **before** broadcasting; MySQL authoritative; `getHistory(afterId)` replay (take 500); subscribe with id-dedupe | `backend/.../monitoring/ActivityEventPublisher.java` | **PORT** — this design is exactly right for no-Redis |
| `routes/runs.routes.ts:89-171` | SSE endpoint: history replay honouring `Last-Event-ID`, then live events, `: ping` heartbeat every 15s, auto-close on terminal status | `api/RunEventController.java` (`SseEmitter`) | **PORT** |
| `monitoring/monitoring.types.ts` | Canonical activity action vocabulary (RUN_COMPLETED/FAILED/CANCELLED, SOURCE_DISCOVERY_STARTED/SOURCE_DISCOVERED, SCRAPE_STARTED/COMPLETED, EXTRACTION_STARTED, RECORDS_EXTRACTED, VALIDATION_COMPLETED, DEDUPLICATION_COMPLETED, DATASET_CREATED) | `monitoring/ActivityAction.java` (enum) | **PORT** — and align it with the 15 event names the frontend already handles (see `G-api-map.md`) |
| `db/repositories/dataset-query.repository.ts` (791 lines) | listDatasets with search across name/description/requirement (:94-99), getDataset(+columns), getDatasetSchema, getDatasetRows with pagination/sort/validOnly/duplicatesOnly/verificationStatus/confidence range/sourceId/`filter[field]` (:67-107), getRowEvidence, getDatasetSources, getSource, deleteDataset | `backend/.../dataset/DatasetQueryService.java` + Spring Data specifications | **PORT** (behaviour). Replace the raw `LIKE '%…%'` over JSON (:732-741) with a FULLTEXT index on a materialized search column |
| `db/repositories/workflow-history.repository.ts` (574 lines) | listWorkflows, getWorkflow, getWorkflowRuns, getRun, getRunActivity, deleteWorkflow | `backend/.../api/WorkflowQueryService.java` | **PORT** |
| `db/repositories/workflow-execution.repository.ts:271-272,352` | `persistDataset` transactional row+evidence write; rejects rows without evidence; verifies sources were fetched in that run | `backend/.../dataset/DatasetPersistenceService.java` | **PORT** the transaction and the evidence requirement — but **fix the silent `continue`** that drops rows without explanation. Dropped rows must be recorded as `ValidationIssue`s and counted, never silently lost |
| `modules/export/export.service.ts:41-53,237-251` + `format-writers.ts` | Chunked (500-row) streaming writers: RFC 4180 CSV, streamed JSON array, ExcelJS streaming XLSX; SHA-256 checksum + file metadata; cleanup and FAILED status on error | `backend/.../export/` | **PORT** the writers; **REIMPLEMENT** the execution model as a real queued job with lease + recovery (old version used in-process promises and stranded jobs on restart) |
| `modules/export/export.repository.ts:122-128` | Path-traversal containment on download | `export/ExportStorage.java` | **PORT** — keep exactly |
| `modules/auth/auth.service.ts:84-115,169-194` | Register (bcrypt + atomic user/workspace/OWNER membership), login, refresh with rotation and old-`jti` revocation, logout, me | `backend/.../security/` | **PORT** (behaviour) into Spring Security, with revocation in **MySQL**, not Redis, and **no silent swallow** of revocation failures |
| `modules/auth/auth.middleware.ts` | `requireWorkspaceAccess(prisma, minRole)` role ranks OWNER>ADMIN>MEMBER; `enforceClientIdentity` rejecting client-supplied `userId`/`createdById` | `security/WorkspaceAccessEvaluator.java`, `security/IdentityGuard.java` | **PORT — and actually mount it.** In the old project it was defined but never applied (`app.ts:71-74`), which is the authorization hole |
| `common/rateLimiter.ts` | Sliding-window HTTP rate limiter (auth 15/min, workflow 30/min) with 429 envelopes + `Retry-After` | `config/ApiRateLimitFilter.java` (Bucket4j) | **PORT** |
| `src/config/env.ts` (+ Zod validation, `DATABASE_URL` synthesis from `MYSQL_*` :99-105) | Fail-fast env validation | `config/` `@ConfigurationProperties` with validation | **PORT** — and add the missing rule: **absent required credential = startup failure**, never a demo fallback |
| `src/logger.ts` (Pino with secret masking) | Masking of tokens, hashes, connection URIs | Logback masking converter | **PORT** |
| `docs/openapi.spec.ts` (1,483 lines, hand-written) | — | generated by springdoc | **DROP** |
| `src/routes/*.routes.ts` response shaping | Synthetic progress `100/50/0` (`workflows.routes.ts:92`), confidence default `90` and fabricated `sourceIds: src-1..N` (`datasets.routes.ts:240-251`), `entity:"Record"` / `targetCount:100` defaults (`requirements.routes.ts:15,32`) | — | **DROP** — fabrication. Return absent data as absent |
| `src/modules/demo/**` (834-line `scenarios.data.ts`, `dynamic-scenario.generator.ts`, `demo-agent.adapter.ts`, demo providers) | Hardcoded Tracxn/Inc42/YourStory sources, 52 real + 50 fabricated startups, "Dr. Ramesh Gupta N", 15 hardcoded YouTube channels, `Item 1..N` directory filler, invented telemetry, `checkConfiguration()` always true | — | **DROP ENTIRELY** |
| `requirements/index.ts:17-19`, `planner/index.ts:19-21`, `server.ts:56-62,83-86` | Silent demo substitution and hardcoded JWT dev secrets | — | **DROP** — replace with fail-closed startup |
| `src/scripts/run-demo.ts`, `backend/demo-exports/**`, `backend/dist/**` | CLI demo runner and 24 checked-in demo artifacts, committed build output | — | **DROP** |
| `backend/tests/**` (20 files, ~200 cases) | Real assertions worth reproducing: SSRF classification, CSV RFC 4180 escaping, dedup, SSE replay, source governance lifecycle, dataset querying, auth | `backend/src/test/java/**`, `ai-service/tests/**` | **PORT (as test intent)** — rewrite in JUnit/pytest. **Exclude** `demo-scenarios.test.ts` and the fixture-asserting parts of `e2e-validation.test.ts`, which lock in demo behaviour |
| `md files/PRD.md` | Product requirements, FR-1…FR-21, non-functional requirements, out-of-scope list | `docs/control/PRD.md` | **DIRECT COPY** (still accurate; only the stack references change) |
| `md files/Rules.md` | Constitution: allowed/prohibited tech, licensing rules, no-fabrication, no-client-secrets, error handling, validation, logging, dependency policy | `docs/control/Rules.md` | **ADAPT** — keep §2 licensing, no-fabrication, no-client-secrets, robots/ToS rules verbatim; rewrite §1 allowed technologies for Java/Python; **replace the BullMQ+Redis clause with the MySQL job rule** |
| `md files/Phases.md` | Phase discipline rule ("do not start a phase until the previous phase's criteria are met and recorded") | `docs/control/Phases.md` | **ADAPT** — keep the discipline rule, replace the phase list with `M-phase-plan.md` |
| `md files/Memory.md` | Living-memory format (status, completed phases, decision log, schema changes, known bugs, env/run commands) | `docs/control/Memory.md` | **ADAPT** (format only). **Do not copy its claims** — several are contradicted by code (§3 of the forensic audit) |
| `md files/Architecture.md`, `md files/Design.md` | — | — | **DROP** (both stale; superseded by `A-final-architecture.md` and the real UI tokens in `D`) |
| `md files/FrontendIntegrationContract.md` (854 lines) | Screen→endpoint mapping, SSE wire format, pagination envelope, dynamic column/filter syntax, evidence relationships | `docs/control/FrontendContract.md` | **ADAPT** — keep as the contract baseline; correct it against `G-api-map.md` (add missing aggregate endpoints, remove fabricated defaults, make auth mandatory) |
| `docker-compose.yml` | Service topology, healthcheck-gated `depends_on`, MySQL 8.4 pin | `deploy/docker-compose.yml` | **ADAPT** — drop `redis`; fix the port/origin mismatch (backend :3000 vs frontend rewrite :4000, `FRONTEND_ORIGIN=localhost:5173`); remove `insecure-default-…` JWT fallbacks; add `ai-service` and `frontend` services |

---

## C.2 `web-agent-main` — Firecrawl Agent Core (MIT)

| Source path | Logic used | Final location | Method |
|---|---|---|---|
| `agent-core/openapi.yaml` (385 lines) | The `RunRequest`/`RunResponse`/`StepDetail`/`usage` shapes; `maxSteps` 1-200 bound; error envelope | Reference only for our own Python↔Java DTOs | **ADAPT** — we do not implement this HTTP surface (Spring calls Python directly), but the shapes are a good contract baseline |
| `agent-core/src/schema-validate.ts` (169 lines) | `validateAgainstSchema`: example-shaped schemas, arrays validated item-by-item, depth-capped walk, empty = missing. **Used identically for prompting, runtime gating, and post-run assessment** (one validator, three uses — deliberate) | `ai-service/app/extraction/schema_validate.py` | **PORT** — the single most valuable correctness feature in the repo, and entirely absent from the Python port |
| `agent-core/src/agent.ts:37-40,42-66,76,78-130` | Two enforcement gates: (a) `formatOutput` is **blocked until at least one data tool returned non-empty data** (`DATA_TOOLS`, `resultHasData`); (b) `formatOutput(format=json)` is validated against the pinned schema with a bounded repair loop, `MAX_SCHEMA_REPAIRS = 3` | `ai-service/app/extraction/gate.py` | **PORT** — this is the anti-hallucination machinery. Without it a model can emit a complete-looking dataset from nothing |
| `agent-core/src/orchestrator/prompts/system.md`, `worker/prompts/system.md`, skills policy text | Tool-usage policy incl. "do not retry 404 / bot-check URLs"; `<required_schema>` + `<field_checklist>` rendering from `extractFieldPaths()` (`orchestrator/index.ts:15-33,146-159`) | `ai-service/app/llm/prompts/*.md` | **DIRECT COPY** (content) — battle-tested prompt text; MIT, keep the LICENSE/notice |
| `.internal/agent-core-py/src/firecrawl_agent/{agent,types,prompts}.py` (352 LOC) | Starting skeleton: PydanticAI wiring, `search`/`scrape`/`format_output` tool shapes, `ModelConfig` provider mapping, `AgentEvent` union, markdown truncation limits (2000/4000 chars), `RunParams`/`RunResult` dataclasses | `ai-service/app/firecrawl/client.py`, `app/contracts/` | **ADAPT** — treat as reference code, not a dependency (it lives in `.internal`, unpublished and unversioned). **Must fix:** wire step limits, populate `steps`, make Firecrawl calls non-blocking, add schema validation, unify event field naming |
| `agent-core/src/toolkit.ts:4,51-102,104-183` | `buildFirecrawlToolkit` as the single SDK touchpoint; `interact` wrapped with a hard **60s** timeout + AbortController + null-field stripping; tool filtering by an enabled list (search/scrape/interact) | `ai-service/app/firecrawl/client.py` | **PORT** (pattern) — one place where our code meets the SDK, per-tool timeout, and a plan-derived tool allowlist |
| `agent-core/src/tool-results.ts` (607 lines) | Normalization of raw search/scrape payloads into a stable UI-friendly shape | `ai-service/app/firecrawl/normalize.py` | **PORT SELECTIVELY** — only the shapes we actually persist/render |
| `agent-core/src/orchestrator/compaction.ts:3-17,31-64,182-190` | Per-model token-limit table; compaction triggered at **75%**; one-shot LLM summarization into an 8-section structured summary; best-effort (failure logged, run continues) | `ai-service/app/llm/compaction.py` | **PORT (later phase)** — only if extraction context grows large. Not needed for v1 |
| `agent-core/src/skills/{parser,discovery,tools,upload}.ts` + `skills/definitions/*.md` | SKILL.md format (gray-matter frontmatter: name/description/category/model/domains/platform), on-demand `load_skill`, domain-matched `lookup_site_playbook`, `read_skill_resource` with a path-traversal guard. Built-in playbooks incl. `structured-extraction`, `deep-research`, `financial-research`, `e-commerce`, `pricing-tracker` | `ai-service/app/skills/` (loader) + `ai-service/skills/*.md` (content) | **PORT** the loader (~300 lines of simple fs + frontmatter), **DIRECT COPY** the `structured-extraction` SKILL.md content. Defer the rest — skills are not on the v1 critical path |
| `agent-core/src/orchestrator/sub-agents.ts:24-40,116-168`, `worker/index.ts:23-27,45,61-64,97-99` | Configured subagents as tools with their own model/instructions/filtered tools/step caps; `spawnAgents` parallel workers capped at `maxWorkers` (6), **search+scrape only — no interact** ("browser sessions too heavy for parallel workers"), per-worker **5-minute** timeout, in-memory progress map | `backend/.../engine/` (parallel step fan-out) | **REIMPLEMENT in Java** — our job engine already models parallel steps; the useful *facts* to carry over are the caps: no `interact` in parallel fan-out, and a hard per-task timeout |
| `agent-core/src/resolve-model.ts:9-59`, `agent.ts:139-146,620-675` | Provider switch (`gateway`, `anthropic`, `openai`, `google`, `custom-openai`) with lazy imports; `createAgentFromEnv` throwing when `FIRECRAWL_API_KEY` is absent | `ai-service/app/llm/client.py` | **ADAPT** — keep the **fail-loud-on-missing-key** behaviour (the exact thing the old project got wrong), drop multi-provider breadth for v1 |
| `agent-templates/express/server.ts` (227 lines), `Dockerfile`, `doctor.ts` | Complete reference implementation of `openapi.yaml`: graceful shutdown, request IDs, SSE | — | **IGNORE for v1.** Retain as the documented **fallback** if the Python route proves insufficient (see `I` §I.6) |
| `agent-core/README.md:399-401` | **Gemini rejects the `const` keyword in the scrape tool schema** | `ai-service/app/extraction/schema.py` | **PORT (as a constraint)** — our generated JSON Schemas must strip `const`. Directly relevant since Gemini is our default provider |
| `LICENSE` / `UPSTREAM.md` (vendored copy) | MIT provenance record format | `docs/control/THIRD-PARTY.md` | **DIRECT COPY** (the practice) — record source, version, import date, license, and any local delta for everything we port |

---

## C.3 `web-research-agent-master` (MIT — code may be copied)

Verdict from inspection: **hackathon-grade prototype, ~350 lines of real logic.** The pipeline
*shape* and two prompts are worth taking; almost none of the execution code is.

| Source path | Logic used | Final location | Method |
|---|---|---|---|
| `main.py:41-90` | Pipeline shape: analyze query → per-subquery search → rank URLs → scrape → analyze content → aggregate | `backend/.../engine/` step sequencing + `ai-service` | **PORT** (shape only) — must become an async persisted job with parallel collection, not a synchronous request |
| `utils/analyze_query.py:15-33` | The query-analysis **prompt**: classify intent (factual/exploratory/news/opinion/historical), split into subqueries, identify information type, formulate search strategy, classify `invalid` for nonsensical/harmful queries | `ai-service/app/llm/prompts/analyze.md` | **PORT** (prompt content is the value) |
| `utils/analyze_query.py:34-51` | Implementation: `json.loads` on raw text, hardcoded Azure deployment `'gpt-4o-mini-2'`, `print()` on error, fallback dict, and a **JSON syntax error in the prompt template itself** (:28) | — | **REIMPLEMENT** — use Gemini structured output with a Pydantic model; never `json.loads` raw text |
| `utils/get_relevant_urls.py:3-24` | Ranking algorithm: embed query → embed snippets in one batch → cosine similarity → dedupe by URL keeping **max** similarity → sort desc → top M (M=10) | `governance/SourceRelevanceRanker.java` (optional embedding mode) | **ADAPT** — the old project already ported a lexical variant; keep lexical as default (no API cost) and treat embeddings as an optional mode. **Must add:** a minimum-score threshold (the original always fills the top-10 with garbage), a zero-norm guard (NaN), and domain diversity |
| `utils/get_embeddings.py:4-13` | Embedding factory, `text-embedding-3-small`, `chunk_size=1024` batching | `ai-service/app/llm/embeddings.py` (only if embedding mode is adopted) | **ADAPT** — make provider/model configurable. Note the cost warning below |
| `tools/result_aggregator_tool.py:8-23` | **The conflict-handling / citation prompt** — rule 2 "identify and resolve contradictory information", rule 7 surface contradictions + indicate the value range + pick the most likely by frequency or source reliability + inline `[Source N]` citations, rule 8 Markdown tables with matching pipe counts | `ai-service/app/llm/prompts/conflict.md` | **PORT** — the single most valuable artifact in this repo. Our pipeline preserves conflicts programmatically; this prompt governs how they are *explained* |
| `tools/result_aggregator_tool.py:25-40` | Implementation: hardcoded model, `set()` over URLs → **nondeterministic source ordering**, no citation validation, `print()` of the response | — | **REIMPLEMENT** |
| `utils/web_scraper.py:18-31` | `allowed_to_scrape`: fetch `{scheme}://{netloc}/robots.txt`, parse with `urllib.robotparser`, `can_fetch("*", url)`, fail-closed | `governance/RobotsPolicyService.java` | **REIMPLEMENT** — right idea, but it **re-fetches robots.txt for every URL with no cache**, and treats a 404 robots.txt (which most sites return) as disallowed. We need per-origin caching with TTL and an explicit, documented policy for missing robots.txt |
| `utils/web_scraper.py:33-45` | `fetch_page(retries=3, backoff=1.0)` with exponential backoff `backoff * 2**i` | `governance/RetryPolicy.java` | **PORT** (the formula). Note the only caller passes `retries=1`, so retries were **effectively disabled** — do not reproduce that |
| `utils/web_scraper.py:38,47-50` | `print(f"Got response from {url}: {resp.text}")` dumps every page body to stdout; `BeautifulSoup(...).get_text()` keeps `<script>`/`<style>`; no User-Agent; no rate limit; new `AsyncClient` per request | — | **REIMPLEMENT** — log pollution + data leak; use Firecrawl markdown or `trafilatura` |
| `tools/web_scraper_tool.py:6-23` | Per-URL error isolation (one bad URL doesn't kill the batch) | `ai-service/app/firecrawl/client.py` | **ADAPT** — keep isolation, but use `asyncio.gather` + `Semaphore`, not a sequential `for` loop inside `async def` (:8) |
| `tools/content_analyzer_tool.py:9-13` | Chunking defaults `chunk_size=1000, chunk_overlap=50` | `ai-service/app/extraction/chunking.py` | **PORT** (parameters) |
| `tools/content_analyzer_tool.py:24-32` | Ephemeral in-memory Chroma per request, `k=5` retrieval — and it retrieves using `search_strategy` (the LLM's strategy *sentence*) instead of the user's query | — | **DROP** — a per-request vector DB discarded after one lookup is pure cost, and the retrieval query is a semantic bug |
| `schemas.py:4-16` | `ResearchRequest{query}`, `Document{content, sources}`, `ResearchResponse{query, result}` | reference only | **IGNORE** — our contracts are richer |
| `tools/web_search_tool.py:6-15` | LangChain `GoogleSearchAPIWrapper` CSE wrapper | — | **IGNORE** — Firecrawl search replaces it. If a non-Firecrawl fallback is ever wanted, prefer `TheAgenticBrowser`'s direct `requests` CSE call (below), which has no framework dependency |
| `utils/logging.py` | colorama console logger | — | **IGNORE** |
| `test_mock.py` | Mocks every component; tests wiring only, zero logic coverage | — | **IGNORE** |
| `.env.example` | `GOOGLE_SEARCH_API_KEY`, `GOOGLE_CSE_ID`, `AZURE_OPENAI_*`, `PORT` | — | **IGNORE** (Azure/CSE not in our stack) |

**Cost warning carried forward:** that pipeline embeds the query, every snippet, *and every
chunk of every scraped page* into a throwaway vector store. At ~10 pages × ~50 chunks that is
the dominant token cost of the whole run for one `k=5` retrieval. We do not reproduce it.

---

## C.4 `TheAgenticBrowser-main` — **Community License: concepts only, no code**

`LICENSE:1-30` §1.1 defines "Excluded Purpose" as making available any SaaS/PaaS/IaaS or
similar online service competing with TheAgentic products. This platform is such a service.
**Zero files may be copied or translated.** Everything below is `PORT (concept only)`: an
independent implementation of an observed pattern, with no derivation from their source.

| Observed at | Pattern (idea only) | Final location | Method |
|---|---|---|---|
| `core/orchestrator.py:282-630`, esp. 585-602 | **plan → act → observe → critique → replan** loop, where the critique's `feedback` string is concatenated into the *next* planner prompt and the planner keeps its own accumulated history so it reasons over the full feedback timeline | `backend/.../engine/steps/VerifyStepHandler.java` + `planner/ReplanService.java` | **PORT (concept only)** — our VERIFY step writes feedback and decides `advance / retry-step / replan / terminate`, with state persisted per iteration |
| `core/agents/critique_agent.py:13-16` | Critique output contract `{feedback: str, terminate: bool, final_response: str}` | `ai-service/app/contracts/critique.py` | **PORT (concept only)** — independently authored schema of the same shape |
| `core/agents/critique_agent.py:26-97` | Termination policy expressed in the prompt: last step done, non-recoverable failure, **≥5 identical loop iterations**, **≥7 distinct remediation strategies exhausted**; plus "final_response must contain the ACTUAL answer, never 'information has been compiled'" | `ai-service/app/llm/prompts/verify.md` | **PORT (concept only)** — reuse the *thresholds as policy numbers*, write our own wording |
| `core/orchestrator.py:311-313,606-615` | **No hard iteration cap** — `iteration_counter` is only logged; termination is 100% LLM-decided; a per-step `except … continue` can spin forever | — | **Lesson: do the opposite.** Hardcoded max-iteration and max-replan caps enforced in Java |
| `core/orchestrator.py:532,534` | Bug: critique prompt references `browser_response.data` / `ss_analysis_response` even when the actor raised and the variable was never assigned → `UnboundLocalError` swallowed by an outer `continue` → **livelock** | — | **Lesson:** never let an exception inside the verification path be swallowed by a loop `continue` |
| `core/orchestrator.py:99-167` | Context hygiene: bulky intermediate payloads (DOM) are replaced with a short placeholder (`"DOM successfully fetched"`) in the history passed to the critic and back to the actor | `ai-service/app/llm/context.py` + store large artifacts out-of-band | **PORT (concept only)** — token control technique |
| `core/orchestrator.py:52-92,23-48` | Tool-trace extraction for the critic's input; history-integrity assertion that every tool call has a matching tool return before planning continues | `backend/.../engine/StepTrace.java` | **PORT (concept only)** |
| `core/utils/ss_analysis.py:47-123` | Independent visual verification (before/after screenshot diff) rather than trusting the actor's self-report | — | **IGNORE** for a data platform — but the underlying principle (*verify with independent evidence, not self-report*) is exactly what our tool-observed-URL rule implements |
| `core/server/api_routes.py:37,96-183` | Task registry + SSE streaming + cleanup as a live-progress channel; duplicate task ids rejected with 400 | `backend/.../monitoring/` | **PORT (concept only)** — but backed by MySQL job state, never an in-process dict |
| `core/agents/browser_agent.py`, `core/skills/**`, `core/utils/get_detailed_accessibility_tree.py`, `core/browser_manager.py` | Playwright browser agent, 10 DOM tools, `mmid` attribute injection, class-attribute-singleton browser manager with GUI overlay + video recording, `WORKERS=1` | — | **IGNORE** — we are not building an interactive browser agent; Firecrawl `interact` covers page interaction |
| `requirements.txt:83-84` | `pydantic-ai==0.0.17` alpha (~2 years stale, API radically changed) | — | **IGNORE** |

---

## C.5 `anakin-master` — **AGPL-3.0: concepts only, no code**

`NOTICE:1-4` states AGPL-3.0. Its network-use clause would copyleft the entire product.
**Zero files may be copied or translated**, including `init-db.sql`. Everything below is
`PORT (concept only)`.

Important correction to the brief's assumption: **anakin has no database-backed queue and no
claim mechanism.** Its "queue" is an in-process Go channel (`worker/worker.go:20-36,60-62`);
Postgres is only a state/result store. It is single-instance by design (`README.md:47`:
"no Redis, no AWS, no message queues"). So "adapt anakin's job architecture to MySQL" means
**adding the durability layer anakin itself lacks**.

| Observed at | Pattern (idea only) | Final location | Method |
|---|---|---|---|
| `scripts/init-db.sql:2-23` (`scrape_requests`) | Job table column set: `id, job_type, url, status, payload, cached, html_length, success, error, result, duration_ms, parent_job_id, created_at, completed_at`; indexes on `status`, `parent_job_id`, `created_at`, `url` | `db/migration/V1__baseline.sql` → `workflow_jobs` | **PORT (concept only)** — independently authored MySQL DDL for the same *information*. **Add what anakin lacks:** `attempt_count`, `max_attempts`, `next_retry_at`, `locked_at`/`lease_expires_at`, `worker_id`, `version`, `updated_at`; status as `ENUM` with service-layer transition enforcement |
| `scripts/init-db.sql:26-49` (`domain_configs`) | Per-domain policy table: `handler_chain`, `request_timeout_ms`, `max_retries`, `min_content_length`, `failure_patterns`/`required_patterns` (regex CSV), `custom_headers`, `custom_user_agent`, `blocked`/`blocked_reason` | `db/migration/…` → `source_domain_policy` | **PORT (concept only)** — an excellent model for our per-source governance config |
| `models/types.go:11-22` | Status vocabulary `pending → processing → completed \| failed`; job types | `domain/enums/JobStatus.java` | **PORT (concept only)** — we extend to the brief's 7 states (`PENDING, RUNNING, COMPLETED, FAILED, SKIPPED, BLOCKED, CANCELLED`) |
| `models/types.go:11-16` + `store/postgres.go:29-31,106-128` | Status is a bare `VARCHAR(20)` with **no CHECK constraint and no transition guard anywhere** — enforcement is purely procedural | — | **Lesson: do the opposite.** MySQL `ENUM` + an explicit transition table in the service layer + `WHERE status = <expected>` on every UPDATE |
| `worker/worker.go:19-69` | Pool sizing (`WORKER_POOL_SIZE`=5), bounded buffer (`JOB_BUFFER_SIZE`=100) giving **backpressure** (a blocking channel send stalls the HTTP request), per-job `context.WithTimeout` (`JOB_TIMEOUT`=120s), and `Drain()` on shutdown | `config/AsyncConfig.java` → `ThreadPoolTaskExecutor(corePoolSize, queueCapacity, CallerRunsPolicy)` + `@PreDestroy` drain + `SmartLifecycle` phases | **PORT (concept only)** — maps 1:1 onto Spring |
| *(absent)* — `worker.go:60-62`, `scraper.go:59-67` | **No DB claim exists.** Double-processing is prevented only because a Go channel delivers each message once *within one process*. Grep confirms no `FOR UPDATE`, no `SKIP LOCKED`, no advisory lock, no version column anywhere in `server/` | `engine/JobClaimRepository.java` | **REIMPLEMENT** — this is the gap. Use MySQL `FOR UPDATE SKIP LOCKED` or an atomic conditional `UPDATE`. SQL in `J-no-redis-job-architecture.md` |
| *(absent)* | **No heartbeat, no stale-job recovery, no requeue sweeper.** On crash, buffered/in-flight messages are lost and rows stay `pending`/`processing` forever | `engine/StaleJobRecoveryTask.java` (`@Scheduled`) | **REIMPLEMENT** — lease column + sweeper resetting expired `RUNNING` → `PENDING` |
| `processor/processor.go:24-33` | **`persistCtx`**: terminal-state DB writes use `context.WithoutCancel(ctx)` + a fresh 5s timeout, because the job context is already expired when recording failure — otherwise "a job that timed out stays stuck in 'processing' forever" | `engine/JobFinalizer.java` with `@Transactional(propagation = REQUIRES_NEW)` | **PORT (concept only)** — the single most valuable operational insight in the repo. Final-state writes must never share the cancelled job's transaction/context |
| `processor/processor.go:65-92,94-275,287-328` | Job executor flow: mark processing → handler chain → validate content → convert → store result → completed; `handleFailure` → failed | `engine/WorkflowExecutor.java` | **PORT (concept only)** — cleanest end-to-end executor template found in any of the four repos |
| `processor/processor.go:139-179` | Per-attempt retry loop inside one execution: `maxRetries=1` default (2 attempts), overridden per domain (default 2 → 3 attempts), **no backoff** (immediate retry), also retries on content-validation failure. Retry count lives **only in a loop variable** — never persisted; a failed job is terminal and never requeued. `MAX_JOB_RETRIES` env exists (`config.go:26,64`) but is **dead config, never referenced by the processor** | `engine/RetryPolicy.java` | **PORT (concept only) + fix all three defects**: persist `attempt_count`, add exponential backoff **with jitter**, and schedule `next_retry_at` so a failed job can be re-driven |
| `domain/detector.go:27-81` | Deterministic content-validation gate: minimum length, failure-pattern regex match, required-pattern absence — each carrying a `ShouldRetry` flag | `governance/ContentQualityDetector.java` | **PORT (concept only)** — a cheap pre-LLM quality gate that complements the LLM VERIFY step. Precompile the regexes (their own `TODOS.md:14-22` admits the perf gap) |
| `http/handlers/scraper.go:236-301` + `store/postgres.go:136-174` | Batch model: validate 1-10 URLs → insert a **parent** row (`job_type=batch_url_scraper`) → insert one **child per URL** with `parent_job_id` → children are ordinary jobs, the parent is never "executed". Completion rollup on write via `COUNT(*) FILTER (WHERE status=…)` over children | `engine/BatchFanout.java`, `workflow_jobs.parent_job_id` | **PORT (concept only)** — same-table parent/child with count-based rollup is exactly right for fanning out per-source collection. **Fix the race:** anakin reads then writes without locking the parent; do it in one atomic `UPDATE … WHERE NOT EXISTS (…)` or lock the parent `FOR UPDATE` |
| `http/handlers/scraper.go:303-380` | Read-side derived batch status recomputed from children on every poll | `api/RunQueryService.java` | **PORT (concept only)** — good for a responsive UI; never the source of truth |
| `http/handlers/scraper.go:82-189` | Sync endpoint: poll the store every **500ms** until terminal or deadline (default 30s, max 120s); on timeout return **408 with the job id and instructions to keep polling async** | `api/` — optional convenience endpoint | **PORT (concept only)** — best-in-class hybrid sync/async UX |
| `http/handlers/scraper.go:33-78,191-234` + `docs/API.md:112-231,597-631` | Async submit → `201 {id, status:'pending'}`; `GET /:id` returns the full result once completed; error envelope `{error, message}`; documented polling guidance (1s initial wait, poll 1-2s, client timeout 60-120s) | `api/` conventions | **PORT (concept only)** — our `202 {runId}` + poll/SSE matches |
| `http/router/router.go:41-63,74-112` | API-key auth: constant-time compare, accepted as `X-API-Key`, `Api-Key`, or `Authorization: Bearer`; write routes always require a key, `GET /health` never does | `security/InternalApiAuth.java` (for the Spring→Python internal boundary) | **PORT (concept only)** — the internal AI-service boundary needs exactly this |
| `http/handlers/scraper.go:390-410`, `netguard/netguard.go`, `handler/http.go:40-48` | SSRF guard: scheme/host validation + host validation rejecting loopback/private/link-local (incl. cloud metadata `169.254.169.254`) unless explicitly allowed, **and a dial-time guard against DNS rebinding and redirects** | `governance/SsrfGuard.java` | **PORT (concept only)** — the old TypeScript project already has an equivalent (`SourceValidator.ts:84+`, `:226-234`), so port from there; anakin independently confirms the dial-time check is necessary |
| `handler/chain.go:25-78`, `docs/handlers.md:5-22` | Chain of responsibility HTTP → Browser → optional API, each tried once per attempt, gated by `CanHandle`/`IsHealthy`, aggregated error `all handlers failed: <lastErr>`; 10MB body cap | `ai-service/app/firecrawl/` strategy chain (scrape → interact fallback) | **PORT (concept only)** — ordered `List<CollectionHandler>` beans with `canHandle/isHealthy/collect` |
| `domain/cache.go:14-72,74-80` | Domain-config cache with a 60s refresh ticker; exact-host match then parent-domain match | `governance/DomainPolicyCache.java` (`@Scheduled(fixedDelay=60s)` + `ConcurrentHashMap`) | **PORT (concept only)** |
| `processor.go:207-222`, `gemini/client.go` | LLM structured extraction as an **optional, non-blocking enrichment**: failure sets `generatedJson.status='failed'` without failing the job | `engine/steps/ExtractStepHandler.java` | **PORT (concept only)** — sensible degradation policy |
| `cmd/server/main.go:59-61,134-141,182-210` | DB pool sizing (MaxOpen 25 / MaxIdle 5 / ConnMaxLifetime 5m); HTTP server timeouts (read/write 30s, idle 120s, body 10MB); graceful shutdown ordering: stop ingress → cancel background → drain workers → stop subsystems | `config/` + `SmartLifecycle` phases | **PORT (concept only)** |
| `browser-service/server.py:42-44,60-87,160-221` | Sidecar watchdog: subprocess supervisor restarting the browser with exponential backoff 1s→30s, health endpoint 200/503 by state, graceful terminate→kill escalation | `deploy/` process supervision for the FastAPI service | **PORT (concept only)** |
| `webapp/src/hooks/useJobs.ts`, `webapp/src/pages/JobDetail.tsx:42-59`, `Jobs.tsx:14-26` | Job monitor UX: `setInterval(…, 2000)` polling until terminal, localStorage-tracked job history | `frontend/hooks/` | **PORT (concept only)** — as the **fallback** when SSE is unavailable |
| `proxy/pool.go`, `proxy/sampler.go:39-109`, `init-db.sql:52-62` | Thompson Sampling proxy selection: Beta(α,β) priors sampled via Marsaglia-Tsang Gamma sampling, success → α++, latency EMA 0.2, failure → β++, 403-blocked → β+=10 plus a 5-minute per-domain block, UPSERT persistence every 60s | — | **IGNORE** unless we run a proxy fleet. If we ever need to choose among LLM providers or collection routes, this is a self-contained bandit worth remembering |
| `store/memory.go:14-22`, `telemetry/**`, `TELEMETRY.md` | In-memory store fallback; vendor telemetry | — | **IGNORE** |
| `docker-compose.yml:1-47` | Topology with healthcheck-gated `depends_on` | `deploy/docker-compose.yml` | **PORT (concept only)** — swap Postgres→MySQL, add `ai-service` and `frontend`, keep healthcheck gating |

**Also note:** anakin is **PostgreSQL** (`lib/pq`, `store/postgres.go`), so its DDL uses
`UUID`/`gen_random_uuid()`, `TIMESTAMP WITH TIME ZONE`, and `COUNT(*) FILTER (WHERE …)` —
none of which is MySQL syntax. Even setting licensing aside, its schema would need translation,
not adoption.

---

## C.6 Reuse totals

| Repository | License | Code copied | Concepts ported | Dropped |
|---|---|---|---|---|
| Old project (`AI-Powerd Data Intelligence`) | proprietary (yours) | 0 files verbatim; schema + contracts + pipeline **ported** | ~40 components | entire `demo/` tree, silent fallbacks, fabricated route defaults, BullMQ/Redis layer, vendored TS core, hand-written OpenAPI, stale `Architecture.md`/`Design.md` |
| `web-agent-main` | MIT | prompt content + `structured-extraction` SKILL.md (**DIRECT COPY**, with provenance) | `schema-validate`, the two enforcement gates, toolkit gating, event/tool-result shapes, compaction (deferred), skills loader (deferred) | LangChain/deepagents harness, vendoring, Express template (kept as documented fallback) |
| `web-research-agent-master` | MIT | 0 files verbatim | 2 prompts, retry backoff formula, chunking params, ranking algorithm (adapted) | ephemeral Chroma, scraper, aggregator code, Azure/CSE wiring, mock test |
| `TheAgenticBrowser-main` | Community License | **0 — prohibited** | 8 patterns (critique loop, feedback→replan, termination thresholds, context hygiene, tool trace, task registry+SSE) | browser agent, DOM skills, Playwright manager, alpha pins |
| `anakin-master` | AGPL-3.0 | **0 — prohibited** | 14 patterns (job schema information, lifecycle, pool/backpressure, `persistCtx`, executor flow, batch rollup, sync-poll UX, content detector, handler chain, SSRF, caching, shutdown ordering, sidecar watchdog, polling UX) | proxy bandit, telemetry, memory store |

Next: `D-frontend-reuse-map.md`.
