# C. Repository Reuse Map

Every row records the six fields the brief requires:

**Repository → Useful feature → Source path → Actual implementation → Reuse method → Destination**

- *Source path* — file (with line range where it matters), relative to that repository.
- *Actual implementation* — what the code **really does**, as read, including defects. This is
  deliberately separate from "useful feature": several components do not do what their docs claim.
- *Destination* — path in `FINALAIAGENT`. `—` means nothing is carried forward.

Integration methods:

| Method | Meaning |
|---|---|
| **DIRECT COPY** | file/content reused essentially unchanged |
| **ADAPT** | same design, modified to fit the new stack |
| **PORT** | logic reimplemented in another language, preserving behaviour |
| **PORT (concept only)** | pattern studied, implementation written independently. **Mandatory for all AGPL / Community-License material** (`anakin-master`, `TheAgenticBrowser-main`) |
| **WRAP** | call an external library through our own thin adapter |
| **REIMPLEMENT** | idea kept, existing code judged unfit |
| **IGNORE / DROP** | not carried forward |

## C.0 Target folder structure (referenced by all tables below)

```
FINALAIAGENT/
├── docs/
│   ├── audit/                       ← this Phase 0 output (A–N)
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

| Repository | Useful feature | Source path | Actual implementation | Method | Destination |
|---|---|---|---|---|---|
| old project | Full domain model | `backend/prisma/schema.prisma` (16 models, 17 enums, 7 migrations) | 16 Prisma models: User, Workspace, WorkspaceMember, Workflow, WorkflowPlan (versioned), WorkflowRun, WorkflowStep, Dataset, DatasetColumn, DatasetRow, Source, SourceEvidence, ValidationIssue, DeduplicationEvent, DataQualityReport, ExportJob, ActivityEvent. Sound shape; Prisma-specific attributes only | **PORT** (Prisma → JPA + Flyway DDL). See `E-database-model.md` | `backend/.../domain/`, `resources/db/migration/V1__baseline.sql` |
| old project | Tenant-scoped compound FKs | same — `@@id`/FK blocks, e.g. `(workspaceId, datasetId)` | Compound foreign keys make a cross-workspace link **structurally unrepresentable**, not merely filtered | **PORT** — keep unchanged; best idea in the old schema | `domain/` `@Table(uniqueConstraints…)` + FK definitions |
| old project | Dynamic datasets | same — `DatasetColumn` + `DatasetRow.values` | Registered typed columns + JSON row values, so a new prompt yields new columns without a migration | **PORT** | `domain/DatasetColumn.java`, `domain/DatasetRow.java` |
| old project | ~~Demo login seed~~ | `backend/prisma/seed.ts:39-69` | Inserts a standing credential `demo@pirateagent.ai` / `Demo1234!` into every environment that runs the seed | **DROP** — backdoor credential | — |
| old project | Safe dev bootstrap | `backend/prisma/seed.ts:1-30` | Creates dev user/workspace and **refuses when `APP_ENV=production`** | **ADAPT** — keep the production refusal | `db/migration/afterMigrate` or a `--seed` profile |

### C.1.2 Contracts — the highest-value portable artifacts

| Repository | Useful feature | Source path | Actual implementation | Method | Destination |
|---|---|---|---|---|---|
| old project | Requirement data contract | `backend/src/modules/requirements/requirement.schema.ts` | Zod schema: objective, entityType, quantity, geography{places,scope,includeSubregions}, timeRange, filters (12 operators), constraints, typed snake_case fields, requiredFields ⊕ optionalFields cross-validation, sourcePreferences, sourceRestrictions, deduplicationKeys, validationRules, outputFormat, ambiguities, missingInformation, warnings | **PORT** to both languages. Python produces it; Java re-validates it. Never trust one side | `ai-service/app/contracts/requirement.py` (authoritative) + `backend/.../requirement/RequirementContract.java` |
| old project | Plan contract + safety floor | `backend/src/modules/planner/workflow-plan.schema.ts` | 2–30 steps over a 10-type vocabulary; per-step `retryPolicy` (maxAttempts ≤5, `none`/`exponential`, retryableErrors ⊂ {TIMEOUT, RATE_LIMIT, TRANSIENT_NETWORK, SERVER_ERROR}); `timeoutMs` 1s–300s; dependencies must reference earlier steps; **≥1 EXTRACT and ≥1 SAVE** (:144-145); safety literals `respectRobotsTxt/respectSiteTerms=true`, `allowAuthentication/allowCaptchaBypass=false` (:61-64); `maxRequestsPerDomainPerMinute ≤60`; sourcePolicy, searchStrategy, extractionSchema (`additionalProperties:false`), 7 transformation ops, 10 validation rule codes, dedup rules, completionCriteria (`requireSourceEvidence=true`), outputConfiguration; plan↔requirement cross-check (:166-182) | **PORT** to both. The safety literals become **constants in Java**, not LLM-controlled — the model must not be able to relax them | `ai-service/app/contracts/plan.py` + `backend/.../planner/WorkflowPlanValidator.java` |
| old project | Bounded plan-correction loop | `backend/src/modules/planner/planner.service.ts:45-80` | generate → validate → on failure feed the issue list back into the prompt → re-validate; **2 attempts**, then fails closed | **PORT** (pattern). Keep the bound at 2, then fail closed | `ai-service/app/llm/planner.py`, `backend/.../planner/PlanningService.java` |
| old project | Anti-injection requirement prompt | `backend/src/modules/requirements/prompt.ts:3-20` | Analysis-only framing; "user text is untrusted data"; infer 4–6 default fields **only** when the user names none; quantity-defaulting guidance | **ADAPT** — keep the anti-injection wording verbatim. Field examples stay *prompt guidance only* and must never become code defaults | `ai-service/app/llm/prompts/requirement.md` |
| old project | Planner prompt | `backend/src/modules/planner/prompt.ts` | Safety rules, fixed step vocabulary, "must stop at planning", correction replay | **ADAPT** | `ai-service/app/llm/prompts/plan.md` |

### C.1.3 Data-intelligence pipeline → Python

| Repository | Useful feature | Source path | Actual implementation | Method | Destination |
|---|---|---|---|---|---|
| old project | Field normalization | `data-intelligence/NormalizationService.ts` | Alias→canonical map (:4-13), key folding, empty-value set (:15), URL/date/phone/currency/number coercion, currency-field heuristic `/funding\|salary\|price\|revenue\|amount\|cost\|budget\|valuation/i` (:147), country names via `Intl.DisplayNames` (:211-225), first-non-empty-wins with alias conflicts noted (:40-43) | **PORT**. Replace `Intl.DisplayNames` with a static ISO-3166 table (deterministic, testable) | `ai-service/app/quality/normalize.py` |
| old project | Record validation | `data-intelligence/ValidationService.ts` | Per-record source-evidence check (:17,26-30 → `SOURCE_EVIDENCE` ERROR), REQUIRED/TYPE/URL/EMAIL/DATE/ENUM from the extraction schema, COUNTRY check, `isValid` derivation, verification states, per-field confidence heuristic `min(0.7, 0.45+0.1*(sources-1))` (:142). Honest: unimplemented RANGE/CUSTOM are **downgraded to WARNING**, not silently passed | **PORT** (Python, advisory) + **REIMPLEMENT** (Java, authoritative gate). Keep the downgrade-rather-than-fake behaviour | `ai-service/app/quality/validate.py`, `backend/.../dataset/RowContractEnforcer.java` |
| old project | Deduplication | `data-intelligence/DeduplicationService.ts` | Deterministic blocking index on rule keys; EXACT vs NORMALIZED only; FUZZY_REVIEW **excluded** from auto-merge (:20); URL-aware normalization; merge-into-canonical with conflict capture; duplicate→canonical links; event emission | **PORT** | `ai-service/app/quality/dedupe.py` |
| old project | Entity resolution | `data-intelligence/EntityResolutionService.ts` | Name-field regex (:15), legal-suffix stripping (:14), blocking on first-2-chars + normalized identifiers (url/website/domain/linkedin/email/registration/tax) (:94-101), Levenshtein (:127-144), threshold **0.94** (:24); merges **only** with a shared stable identifier, else KEPT_SEPARATE / REVIEW_REQUIRED | **PORT**; use `commons-text`/`rapidfuzz`. Keep "identifier required to merge" — it is what prevents silently combining distinct records | `ai-service/app/quality/entity_resolution.py` |
| old project | Quality scoring | `data-intelligence/DataQualityService.ts:35-46,77-79` | `clamp(0.2+0.15+min(0.2,(domains-1)*0.1)+completeness*0.25+(errors?0:0.15)-warnings*0.025-conflicts*0.1, 0.05, 0.95)`; 0.05 when not source-backed. A heuristic dressed as a metric | **PORT** — but document as **heuristic, not measured truth**. The old UI labelled it "confidence", which overstates it | `ai-service/app/quality/score.py` |
| old project | Conflict-preserving merge | `data-intelligence/recordMerge.ts` | Canonical merge capturing per-field conflicts instead of overwriting | **PORT** | `ai-service/app/quality/merge.py` |

### C.1.4 Source governance → Java

| Repository | Useful feature | Source path | Actual implementation | Method | Destination |
|---|---|---|---|---|---|
| old project | SSRF guard | `sources/SourceValidator.ts:84+` | `isNonPublicHost`: RFC1918, loopback, CGNAT 100.64/10, link-local 169.254/16 (cloud metadata), IPv6 forms; canonical URL + SHA-256 hash; credential-stripping `safeUrl` | **PORT** — mandatory for a scraping platform | `backend/.../governance/SsrfGuard.java`, `UrlCanonicalizer.java` |
| old project | DNS-rebinding defence | `sources/SourceValidator.ts:226-234` | Resolves the host and re-checks the answer before the outbound call | **PORT** | `governance/SsrfGuard.java` (resolve → pin → validate) |
| old project | robots policy | `sources/RobotsPolicyService.ts` | Fetch with configurable UA (`SOURCE_ROBOTS_USER_AGENT`, default `ScoutlyBot`), UA-group parsing, allow/disallow specificity, crawl-delay, per-origin cache, 512 KB cap, **fail closed** on any fetch error | **PORT** — keep fail-closed; it reduces yield, so surface `BLOCKED`/`SKIPPED` reasons in the UI rather than hiding them | `governance/RobotsPolicyService.java` |
| old project | Per-domain rate limit | `sources/RateLimitService.ts:13-36` | Redis Lua sliding window (`ZREMRANGEBYSCORE`/`ZCARD`/`ZADD`), honours robots crawl-delay, fails closed when Redis is unreachable | **REIMPLEMENT** with Bucket4j in-memory — same window + crawl-delay floor, no Redis. Document the single-node limit | `governance/DomainRateLimiter.java` |
| old project | Timeout/retry executor | `sources/RetryPolicy.ts` | Abort-signal timeout + bounded backoff; typed `SourceOperationError` codes | **PORT** (Resilience4j) | `governance/RetryPolicy.java` |
| old project | Source lifecycle gate | `sources/SourcePolicyService.ts:32-162,175-180` | validate → persist DISCOVERED → allow/block → robots → QUEUED → PROCESSING → rate-limit → execute with retries → COLLECTED/FAILED/SKIPPED/BLOCKED, sanitized errors | **PORT** — the authoritative gate. Python may only collect URLs Java has cleared | `governance/SourceGovernanceService.java` |
| old project | Relevance ranking | `sources/RelevantSourceSelector.ts:11-96` | Token coverage `0.55*title + 0.3*snippet + 0.15*url`, phrase boost 0.25, preferred-domain boost 0.15, floor 0.12, canonical dedupe, per-domain repeat penalty 0.08, tracking-param stripping | **PORT**. Promote the weights to **configuration**, not magic numbers | `governance/SourceRelevanceRanker.java` |

### C.1.5 Agent adapter & integrity rules

| Repository | Useful feature | Source path | Actual implementation | Method | Destination |
|---|---|---|---|---|---|
| old project | **Tool-observed-URL rule** | `agent/AgentResultNormalizer.ts:41-49,169` | Keeps only URLs actually seen in a tool result; model-reported URLs get `verifiedByTool=false`; records with no observed source are flagged `SOURCE_EVIDENCE_UNVERIFIED` | **PORT** — the anti-fabrication backbone. Enforce server-side, never in client or model | `backend/.../provenance/EvidenceIntegrity.java` |
| old project | Snippet-containment verification | `evidence/provenance.service.ts:12-48` | `isSnippetVerifyingValue`: a snippet corroborates a value only if the value (or all its ≥3-char tokens) literally appears in it; else `isVerified:false` | **PORT** — behaviour verbatim | `provenance/SnippetVerifier.java` |
| old project | Evidence explorer | `evidence/provenance.service.ts` (`buildRowEvidenceExplorer`) | Row-evidence assembly, multi-source row provenance, conflict history | **PORT** | `provenance/ProvenanceService.java` |
| old project | Plan-derived tool gating | `agent/FirecrawlAgentAdapter.ts:168-177` | Enables only the tools the validated plan implies | **PORT** (pattern) — allowlist passed per request from Java | `ai-service/app/firecrawl/client.py` |
| old project | Governance wrapper around tools | `agent/FirecrawlAgentAdapter.ts:242-309` | Per-URL public-host check, blocked-domain check, per-domain rate window — **inside** the agent loop | **ADAPT** — move the gate **out** of the agent into the orchestrator, where it cannot be bypassed | `backend/.../governance/` |
| old project | Collection prompt | `agent/FirecrawlAgentAdapter.ts:201-230` | Injects objective, required fields, target count, queries, domain policy, completion criteria; demands `{records:[{values,sourceUrls}]}`; explicit "never fabricate" | **PORT** | `ai-service/app/llm/prompts/extract.md` |
| old project | Schema derivation | `agent/FirecrawlAgentAdapter.ts:179-199` | Builds the JSON output schema from `plan.extractionSchema` | **PORT** | `ai-service/app/extraction/schema.py` |
| old project | Step/worker budgets | `agent/FirecrawlAgentAdapter.ts:91-93` | `maxSteps = clamp(6..40, steps*3)`, `maxWorkers=3` when desiredSourceCount>5 | **ADAPT** — with Spring owning the DAG, "steps" become per-step source caps | `ai-service` config + Java step budgets |
| old project | Secret redaction | `agent/FirecrawlAgentAdapter.ts:403-419` | Masks tokens/keys in error text before persistence | **PORT** | `backend/.../config/SecretMasking.java` + Python log filter |
| old project | Event mapping | `agent/AgentEventMapper.ts:5-11` | Core events → `agent.tool.started/completed/failed/progress` via a tool→step-type map | **ADAPT** | `ai-service/app/api/v1/events.py` → Java `monitoring/` |
| old project | Agent result contract | `agent/types.ts` | `AgentResult{status, records[{values,rawValues,sourceUrls,quality,isValid,validationIssues}], sources[{url,canonicalUrl,domain,title,snippet,sourceType,retrievedAt,verifiedByTool}], execution{provider,model,duration,tokens,toolCallCount,toolsUsed}, events, errors}` — well shaped | **PORT** as the Python↔Java wire contract | `ai-service/app/contracts/result.py`, `backend/.../aiclient/dto/` |
| old project | Test double | `agent/MockAgentAdapter.ts` | Deterministic adapter for provider-free tests | **REIMPLEMENT** | both test suites |
| old project | ~~Vendored TS agent core~~ | `packages/firecrawl-agent-core/**` (`0.1.0-vendor.1`) | LangChain + deepagents harness; only delta vs upstream was `apiUrl` pass-through in `src/types.ts`. Cannot be imported from Python at all | **DROP** — call the Firecrawl Python SDK instead | — |

### C.1.6 Execution engine, monitoring, API

| Repository | Useful feature | Source path | Actual implementation | Method | Destination |
|---|---|---|---|---|---|
| old project | Step runner | `modules/workflows/workflow-runner.ts:24,58-64,102-229` | **Sequential** execution with dependency checking, per-step retry honouring the plan, cancellation checked at step boundaries, progress = step index (self-documented limitation) | **REIMPLEMENT** — keep dependency + cancellation semantics; add real DAG scheduling, finer progress, crash-resume | `backend/.../engine/WorkflowExecutor.java` |
| old project | ~~EXPORT step~~ | `modules/workflows/workflow-runner.ts:167-169` | Always returns `SKIPPED` with `EXPORT_NOT_IN_PHASE` — the step is a no-op | **REIMPLEMENT** as a real queued step | `engine/steps/ExportStepHandler.java` |
| old project | Run enqueue | `modules/workflows/workflow-execution.service.ts:32` | `queue.add("execute-workflow",{runId},{jobId:runId,…})` on BullMQ. **`jobId=runId` makes re-enqueue after failure impossible** | **REIMPLEMENT** on MySQL (see `J`). Do not reproduce the dedupe key | `engine/JobSubmitService.java` |
| old project | ~~Redis layer~~ | `queue/workflowQueue.ts`, `queue/connection.ts`, `server.ts:35-41,71-79` | Queue names, ioredis config, worker concurrency 2, Redis pub/sub bus | **DROP** — Redis excluded | — |
| old project | Durable-then-broadcast events | `monitoring/event-broadcaster.ts:56-99` | Persists every event to `activity_events` **before** broadcasting; MySQL authoritative; `getHistory(afterId)` replay (500); subscriber-side id dedupe | **PORT** — exactly the right design for no-Redis | `backend/.../monitoring/ActivityEventPublisher.java` |
| old project | SSE with replay | `routes/runs.routes.ts:89-171` | History replay honouring `Last-Event-ID`, then live events, `: ping` every 15s, auto-close on terminal status | **PORT** | `api/RunEventController.java` (`SseEmitter`) |
| old project | Activity vocabulary | `monitoring/monitoring.types.ts` | Canonical actions: RUN_COMPLETED/FAILED/CANCELLED, SOURCE_DISCOVERY_STARTED/SOURCE_DISCOVERED, SCRAPE_STARTED/COMPLETED, EXTRACTION_STARTED, RECORDS_EXTRACTED, VALIDATION_COMPLETED, DEDUPLICATION_COMPLETED, DATASET_CREATED | **PORT** — align with the 15 event names the frontend already handles (`G-api-map.md`) | `monitoring/ActivityAction.java` |
| old project | Dataset querying | `db/repositories/dataset-query.repository.ts` (791 lines) | listDatasets with search over name/description/requirement (:94-99), getDataset(+columns), getDatasetSchema, getDatasetRows with pagination/sort/validOnly/duplicatesOnly/verificationStatus/confidence range/sourceId/`filter[field]` (:67-107), getRowEvidence, getDatasetSources, getSource, deleteDataset. **Search uses raw `LIKE '%…%'` over JSON** (:732-741) — unindexable | **PORT** (behaviour). Replace LIKE-over-JSON with a FULLTEXT index on a materialized search column | `backend/.../dataset/DatasetQueryService.java` + Specifications |
| old project | History queries | `db/repositories/workflow-history.repository.ts` (574 lines) | listWorkflows, getWorkflow, getWorkflowRuns, getRun, getRunActivity, deleteWorkflow | **PORT** | `backend/.../api/WorkflowQueryService.java` |
| old project | Transactional row+evidence write | `db/repositories/workflow-execution.repository.ts:271-272,352` | `persistDataset` writes row and evidence together, rejects rows without evidence, verifies sources were fetched in that run — **but `continue`s silently on a bad row, losing records without a trace** | **PORT** the transaction and evidence requirement; **fix the silent drop** — skipped rows must become `ValidationIssue`s and be counted | `backend/.../dataset/DatasetPersistenceService.java` |
| old project | Streaming export | `modules/export/export.service.ts:41-53,237-251` + `format-writers.ts` | 500-row chunked writers: RFC 4180 CSV, streamed JSON array, ExcelJS streaming XLSX; SHA-256 checksum + file metadata; cleanup and FAILED on error. **Execution used in-process promises — jobs stranded on restart** | **PORT** the writers; **REIMPLEMENT** execution as a queued job with lease + recovery | `backend/.../export/` |
| old project | Download containment | `modules/export/export.repository.ts:122-128` | Resolves the export file and rejects paths escaping the storage dir | **PORT** — keep exactly | `export/ExportStorage.java` |
| old project | Auth lifecycle | `modules/auth/auth.service.ts:84-115,169-194` | Register (bcrypt + atomic user/workspace/OWNER membership), login, refresh with rotation and old-`jti` revocation, logout, me | **PORT** (behaviour) into Spring Security; revocation in **MySQL**; **no silent swallow** of revocation failures | `backend/.../security/` |
| old project | Authorization middleware | `modules/auth/auth.middleware.ts` | `requireWorkspaceAccess(minRole)` with OWNER>ADMIN>MEMBER, and `enforceClientIdentity` rejecting client-supplied `userId`/`createdById`. **Defined but never mounted** (`app.ts:71-74` uses only `optionalAuthenticate`) — routes were effectively unauthenticated | **PORT — and actually mount it.** This is the old project's authorization hole | `security/WorkspaceAccessEvaluator.java`, `security/IdentityGuard.java` |
| old project | HTTP rate limit | `common/rateLimiter.ts` | Sliding window (auth 15/min, workflow 30/min) with 429 envelope + `Retry-After` | **PORT** (Bucket4j) | `config/ApiRateLimitFilter.java` |
| old project | Fail-fast env validation | `src/config/env.ts` (+ Zod, `DATABASE_URL` synthesis :99-105) | Validates the env shape at boot — **but does not treat an absent credential as fatal**, which is what let demo fallback happen | **PORT** — and add the missing rule: **absent required credential = startup failure**, never a fallback | `config/` `@ConfigurationProperties` + validation |
| old project | Log secret masking | `src/logger.ts` (Pino) | Masks tokens, hashes, connection URIs | **PORT** | Logback masking converter |
| old project | ~~Hand-written OpenAPI~~ | `docs/openapi.spec.ts` (1,483 lines) | Manually maintained spec — drifts from the routes it describes | **DROP** — generate with springdoc | — |
| old project | ~~Fabricated route defaults~~ | `src/routes/*.routes.ts` | Synthetic progress `100/50/0` (`workflows.routes.ts:92`); confidence default `90` and invented `sourceIds: src-1..N` (`datasets.routes.ts:240-251`); `entity:"Record"` / `targetCount:100` (`requirements.routes.ts:15,32`) | **DROP** — fabrication. Absent data returns as absent | — |
| old project | ~~Demo layer~~ | `src/modules/demo/**` (`scenarios.data.ts` 834 lines, `dynamic-scenario.generator.ts`, `demo-agent.adapter.ts`, providers) | Hardcoded Tracxn/Inc42/YourStory sources; 52 real + 50 fabricated startups; "Dr. Ramesh Gupta N"; 15 hardcoded YouTube channels; `Item 1..N` directory filler; invented telemetry; `checkConfiguration()` returns `true` unconditionally | **DROP ENTIRELY** | — |
| old project | ~~Silent demo substitution~~ | `requirements/index.ts:17-19`, `planner/index.ts:19-21`, `server.ts:56-62,83-86` | `DEMO_MODE \|\| !hasLlmKey` ⇒ demo providers; `!DEMO_MODE && !FIRECRAWL_API_KEY` ⇒ `DemoAgentAdapter`; hardcoded JWT dev secrets inline | **DROP** — replace with fail-closed startup | — |
| old project | ~~Demo CLI + artifacts~~ | `src/scripts/run-demo.ts`, `backend/demo-exports/**`, `backend/dist/**` | CLI runner; 24 checked-in demo artifacts; committed build output | **DROP** | — |
| old project | Test intent | `backend/tests/**` (20 files, ~200 cases) | Real assertions worth reproducing: SSRF classification, CSV RFC 4180 escaping, dedup, SSE replay, source governance lifecycle, dataset querying, auth. **Excluded:** `demo-scenarios.test.ts` and the fixture-asserting parts of `e2e-validation.test.ts`, which lock in demo behaviour | **PORT (as test intent)** — rewrite in JUnit/pytest | `backend/src/test/java/**`, `ai-service/tests/**` |
| old project | Product requirements | `md files/PRD.md` | FR-1…FR-21, non-functional requirements, out-of-scope list. Still accurate | **DIRECT COPY** | `docs/control/PRD.md` |
| old project | Project constitution | `md files/Rules.md` | Allowed/prohibited tech, licensing rules, no-fabrication, no-client-secrets, error handling, validation, logging, dependency policy | **ADAPT** — keep §2 licensing, no-fabrication, no-client-secrets, robots/ToS verbatim; rewrite §1 technologies; **replace the BullMQ+Redis clause with the MySQL job rule** | `docs/control/Rules.md` |
| old project | Phase discipline | `md files/Phases.md` | "Do not start a phase until the previous phase's criteria are met and recorded" (:97) | **ADAPT** — keep the rule, replace the phase list with `M-phase-plan.md` | `docs/control/Phases.md` |
| old project | Living-memory format | `md files/Memory.md` | Format: status, completed phases, decision log, schema changes, known bugs, env/run commands. **Its claims are contradicted by code** — see `00-FORENSIC-AUDIT.md` §3 and `N-scripts-and-dependencies.md` §N.3 | **ADAPT** (format only). **Do not copy its claims** | `docs/control/Memory.md` |
| old project | ~~Stale docs~~ | `md files/Architecture.md`, `md files/Design.md` | Both describe a system the code is not; `Design.md` specifies a white/blue Inter "Linear/Vercel" UI while the shipped app is parchment/brown Cormorant Garamond | **DROP** — superseded by `A-final-architecture.md` and the real tokens in `D` | — |
| old project | Frontend contract | `md files/FrontendIntegrationContract.md` (854 lines) | Screen→endpoint mapping, SSE wire format, pagination envelope, dynamic column/filter syntax, evidence relationships | **ADAPT** — keep as baseline; correct against `G-api-map.md` (add aggregate endpoints, remove fabricated defaults, make auth mandatory) | `docs/control/FrontendContract.md` |
| old project | Compose topology | `docker-compose.yml` | mysql:8.4 + redis:7-alpine + backend on **:3000** while the frontend rewrite targets **:4000** and `FRONTEND_ORIGIN` defaults to `localhost:5173`; JWT fallbacks literally `insecure-default-…` | **ADAPT** — drop `redis`; fix the port/origin mismatch; remove insecure fallbacks; add `ai-service` and `frontend` | `deploy/docker-compose.yml` |

---

## C.2 `web-agent-main` — Firecrawl Agent Core (MIT)

| Repository | Useful feature | Source path | Actual implementation | Method | Destination |
|---|---|---|---|---|---|
| web-agent-main | Run API shapes | `agent-core/openapi.yaml` (385 lines) | `RunRequest`/`RunResponse`/`StepDetail`/`usage`; `maxSteps` 1–200; error envelope | **ADAPT** — we don't expose this HTTP surface (Spring calls Python directly), but it's a good DTO baseline | `ai-service/app/contracts/`, `backend/.../aiclient/dto/` |
| web-agent-main | **One validator, three uses** | `agent-core/src/schema-validate.ts` (169 lines) | `validateAgainstSchema`: example-shaped schemas, arrays validated item-by-item, depth-capped walk, empty = missing. Used identically for **prompting, runtime gating and post-run assessment** — deliberate | **PORT** — the most valuable correctness feature in the repo, and entirely missing from the Python port | `ai-service/app/extraction/schema_validate.py` |
| web-agent-main | **Anti-fabrication gates** | `agent-core/src/agent.ts:37-40,42-66,76,78-130` | (a) `formatOutput` blocked until ≥1 data tool returned non-empty (`DATA_TOOLS`, `resultHasData`); (b) `formatOutput(json)` validated against the pinned schema with a bounded repair loop, `MAX_SCHEMA_REPAIRS = 3` | **PORT** — without it a model can emit a complete-looking dataset from nothing | `ai-service/app/extraction/gate.py` |
| web-agent-main | Prompt corpus | `agent-core/src/orchestrator/prompts/system.md`, `worker/prompts/system.md`, skills text | Tool-usage policy incl. "do not retry 404 / bot-check URLs"; `<required_schema>` + `<field_checklist>` rendered from `extractFieldPaths()` (`orchestrator/index.ts:15-33,146-159`) | **DIRECT COPY** (content) — battle-tested; MIT, keep LICENSE/notice | `ai-service/app/llm/prompts/*.md` |
| web-agent-main | Python skeleton | `.internal/agent-core-py/src/firecrawl_agent/{agent,types,prompts}.py` (352 LOC) | PydanticAI wiring, `search`/`scrape`/`format_output` shapes, `ModelConfig` provider map, `AgentEvent` union, markdown caps (2000/4000). **Defective: `max_steps` never passed to PydanticAI, `steps` always `[]`, sync SDK calls inside `async def` (61, 81), schema injected as prompt text (169-170)** | **ADAPT as reference only** — lives in `.internal`, unpublished, unversioned. Must fix all four defects | `ai-service/app/firecrawl/client.py`, `app/contracts/` |
| web-agent-main | Single SDK touchpoint | `agent-core/src/toolkit.ts:4,51-102,104-183` | `buildFirecrawlToolkit` is the only place agent-core meets the SDK; `interact` wrapped with a hard **60s** timeout + AbortController + null-field stripping; tools filtered by an enabled list | **PORT** (pattern) — one seam, per-tool timeout, plan-derived allowlist | `ai-service/app/firecrawl/client.py` |
| web-agent-main | Tool-result shaping | `agent-core/src/tool-results.ts` (607 lines) | Normalizes raw search/scrape payloads into a stable UI shape | **PORT SELECTIVELY** — only shapes we persist/render | `ai-service/app/firecrawl/normalize.py` |
| web-agent-main | Context compaction | `agent-core/src/orchestrator/compaction.ts:3-17,31-64,182-190` | Per-model token table; triggers at **75%**; one-shot LLM summary into 8 sections; best-effort (failure logged, run continues) | **PORT (later phase)** — only if extraction context grows. Not v1 | `ai-service/app/llm/compaction.py` |
| web-agent-main | Skills system | `agent-core/src/skills/{parser,discovery,tools,upload}.ts` + `skills/definitions/*.md` | SKILL.md format (gray-matter: name/description/category/model/domains/platform), on-demand `load_skill`, domain-matched `lookup_site_playbook`, `read_skill_resource` with a path-traversal guard. Playbooks incl. `structured-extraction`, `deep-research`, `pricing-tracker` | **PORT** the loader (~300 lines fs + frontmatter); **DIRECT COPY** the `structured-extraction` content. Defer the rest — not on the v1 critical path | `ai-service/app/skills/`, `ai-service/skills/*.md` |
| web-agent-main | Parallel workers | `agent-core/src/orchestrator/sub-agents.ts:24-40,116-168`, `worker/index.ts:23-27,45,61-64,97-99` | Subagents-as-tools with own model/instructions/filtered tools/step caps; `spawnAgents` capped at `maxWorkers` (6), **search+scrape only — no interact** ("browser sessions too heavy for parallel workers"), per-worker **5-minute** timeout, in-memory progress map | **REIMPLEMENT in Java** — the job engine already models parallel steps. Carry the *facts*: no `interact` in fan-out, hard per-task timeout | `backend/.../engine/` |
| web-agent-main | Model resolution + fail-loud | `agent-core/src/resolve-model.ts:9-59`, `agent.ts:139-146,620-675` | Provider switch (`gateway`, `anthropic`, `openai`, `google`, `custom-openai`) with lazy imports; `createAgentFromEnv` **throws** when `FIRECRAWL_API_KEY` is absent | **ADAPT** — keep fail-loud-on-missing-key (the exact thing the old project got wrong); drop multi-provider breadth for v1 | `ai-service/app/llm/client.py` |
| web-agent-main | Reference server | `agent-templates/express/server.ts` (227 lines), `Dockerfile`, `doctor.ts` | Full `openapi.yaml` implementation: graceful shutdown, request IDs, SSE | **IGNORE for v1** — retained as the documented **fallback** if Python proves insufficient (`I` §I.6) | — |
| web-agent-main | Gemini schema constraint | `agent-core/README.md:399-401` | **Gemini rejects the `const` keyword** in the scrape tool schema | **PORT (as a constraint)** — generated JSON Schemas must strip `const`. Directly relevant: Gemini is our default | `ai-service/app/extraction/schema.py` |
| web-agent-main | Provenance record | `LICENSE`, vendored `UPSTREAM.md` | Records source, version, import date, license, local delta | **DIRECT COPY** (the practice) | `docs/control/THIRD-PARTY.md` |

---

## C.3 `web-research-agent-master` (MIT — code may be copied)

Verdict from inspection: **hackathon-grade prototype, ~350 lines of real logic.** The pipeline
*shape* and two prompts are worth taking; almost none of the execution code is.

| Repository | Useful feature | Source path | Actual implementation | Method | Destination |
|---|---|---|---|---|---|
| web-research-agent | Pipeline shape | `main.py:41-90` | analyze query → per-subquery search → rank URLs → scrape → analyze content → aggregate, all **synchronous inside one request** | **PORT** (shape only) — must become an async persisted job with parallel collection | `backend/.../engine/` sequencing + `ai-service` |
| web-research-agent | Query-analysis prompt | `utils/analyze_query.py:15-33` | Classify intent (factual/exploratory/news/opinion/historical), split subqueries, identify information type, formulate search strategy, classify `invalid` for nonsensical/harmful queries | **PORT** — the prompt content is the value | `ai-service/app/llm/prompts/analyze.md` |
| web-research-agent | ~~Query-analysis code~~ | `utils/analyze_query.py:34-51` | `json.loads` on raw model text, hardcoded Azure deployment `'gpt-4o-mini-2'`, `print()` on error, fallback dict, and a **JSON syntax error in its own prompt template** (:28) | **REIMPLEMENT** — Gemini structured output + Pydantic; never `json.loads` raw text | — |
| web-research-agent | URL relevance ranking | `utils/get_relevant_urls.py:3-24` | Embed query → embed snippets in one batch → cosine similarity → dedupe by URL keeping **max** similarity → sort desc → top M (M=10). **No score floor, so it always fills 10 with garbage; no zero-norm guard (NaN)** | **ADAPT** — the old project already ported a lexical variant; keep lexical as default (no API cost), embeddings optional. **Must add** min-score threshold, zero-norm guard, domain diversity | `governance/SourceRelevanceRanker.java` |
| web-research-agent | Embedding factory | `utils/get_embeddings.py:4-13` | `text-embedding-3-small`, `chunk_size=1024` batching | **ADAPT** — provider/model configurable, only if embedding mode is adopted | `ai-service/app/llm/embeddings.py` |
| web-research-agent | **Conflict/citation prompt** | `tools/result_aggregator_tool.py:8-23` | Rule 2 "identify and resolve contradictory information"; rule 7 surface contradictions + give the value range + pick most likely by frequency or source reliability + inline `[Source N]` citations; rule 8 Markdown tables with matching pipe counts | **PORT** — the single most valuable artifact here. Our pipeline preserves conflicts programmatically; this governs how they are *explained* | `ai-service/app/llm/prompts/conflict.md` |
| web-research-agent | ~~Aggregator code~~ | `tools/result_aggregator_tool.py:25-40` | Hardcoded model; `set()` over URLs → **nondeterministic source ordering**; no citation validation; `print()`s the response | **REIMPLEMENT** | — |
| web-research-agent | robots check | `utils/web_scraper.py:18-31` | Fetches `{scheme}://{netloc}/robots.txt`, `urllib.robotparser`, `can_fetch("*", url)`, fail-closed — but **re-fetches per URL with no cache**, and treats a 404 robots.txt (what most sites return) as disallowed | **REIMPLEMENT** — right idea; needs per-origin TTL cache and an explicit, documented missing-robots policy | `governance/RobotsPolicyService.java` |
| web-research-agent | Retry backoff formula | `utils/web_scraper.py:33-45` | `fetch_page(retries=3, backoff=1.0)` with `backoff * 2**i` — **its only caller passes `retries=1`, so retries were effectively disabled** | **PORT** (the formula). Do not reproduce the disabled-retry wiring | `governance/RetryPolicy.java` |
| web-research-agent | ~~Scraper body handling~~ | `utils/web_scraper.py:38,47-50` | `print(f"Got response from {url}: {resp.text}")` dumps every page body to stdout; `BeautifulSoup(...).get_text()` keeps `<script>`/`<style>`; no User-Agent; no rate limit; new `AsyncClient` per request | **REIMPLEMENT** — log pollution + data leak. Use Firecrawl markdown or `trafilatura` | — |
| web-research-agent | Per-URL error isolation | `tools/web_scraper_tool.py:6-23` | One bad URL doesn't kill the batch — but the loop is a sequential `for` inside `async def` (:8), so nothing runs concurrently | **ADAPT** — keep isolation; use `asyncio.gather` + `Semaphore` | `ai-service/app/firecrawl/client.py` |
| web-research-agent | Chunking defaults | `tools/content_analyzer_tool.py:9-13` | `chunk_size=1000, chunk_overlap=50` | **PORT** (parameters) | `ai-service/app/extraction/chunking.py` |
| web-research-agent | ~~Per-request vector store~~ | `tools/content_analyzer_tool.py:24-32` | Ephemeral in-memory Chroma per request, `k=5` — and it retrieves using `search_strategy` (the LLM's strategy *sentence*), not the user's query | **DROP** — a vector DB discarded after one lookup is pure cost, and the retrieval query is a semantic bug | — |
| web-research-agent | ~~Contracts~~ | `schemas.py:4-16` | `ResearchRequest{query}`, `Document{content, sources}`, `ResearchResponse{query, result}` | **IGNORE** — ours are richer | — |
| web-research-agent | ~~CSE search~~ | `tools/web_search_tool.py:6-15` | LangChain `GoogleSearchAPIWrapper` | **IGNORE** — Firecrawl search replaces it. If a non-Firecrawl fallback is ever wanted, `TheAgenticBrowser`'s direct `requests` CSE call has no framework dependency | — |
| web-research-agent | ~~Console logger / mock test / env sample~~ | `utils/logging.py`, `test_mock.py`, `.env.example` | colorama logger; a test that mocks every component and asserts wiring only, zero logic coverage; Azure/CSE variables | **IGNORE** | — |

**Cost warning carried forward:** that pipeline embeds the query, every snippet, *and every chunk
of every scraped page* into a throwaway vector store. At ~10 pages × ~50 chunks that is the
dominant token cost of the whole run for one `k=5` retrieval. We do not reproduce it.

---

## C.4 `TheAgenticBrowser-main` — **Community License: concepts only, no code**

`LICENSE:1-30` §1.1 defines "Excluded Purpose" as making available any SaaS/PaaS/IaaS or similar
online service competing with TheAgentic products. **This platform is such a service.** Zero files
may be copied or translated. Everything below is **PORT (concept only)**: an independent
implementation of an observed pattern, with no derivation from their source.

| Repository | Useful feature | Source path | Actual implementation | Method | Destination |
|---|---|---|---|---|---|
| TheAgenticBrowser | plan → act → observe → critique → replan | `core/orchestrator.py:282-630`, esp. 585-602 | The critique's `feedback` string is concatenated into the *next* planner prompt, and the planner keeps its own accumulated history so it reasons over the full feedback timeline | **PORT (concept only)** — our VERIFY step writes feedback and decides `advance / retry-step / replan / terminate`, state persisted per iteration | `backend/.../engine/steps/VerifyStepHandler.java`, `planner/ReplanService.java` |
| TheAgenticBrowser | Critique output contract | `core/agents/critique_agent.py:13-16` | `{feedback: str, terminate: bool, final_response: str}` | **PORT (concept only)** — independently authored schema of the same shape | `ai-service/app/contracts/critique.py` |
| TheAgenticBrowser | Termination policy | `core/agents/critique_agent.py:26-97` | Last step done; non-recoverable failure; **≥5 identical loop iterations**; **≥7 distinct remediation strategies exhausted**; "final_response must contain the ACTUAL answer, never 'information has been compiled'" | **PORT (concept only)** — reuse the *thresholds as policy numbers*, write our own wording | `ai-service/app/llm/prompts/verify.md` |
| TheAgenticBrowser | ⚠️ No iteration cap | `core/orchestrator.py:311-313,606-615` | `iteration_counter` is **only logged**; termination is 100% LLM-decided; a per-step `except … continue` can spin forever | **Lesson: do the opposite** — hardcoded max-iteration and max-replan caps enforced in Java | `backend/.../engine/` caps |
| TheAgenticBrowser | ⚠️ Swallowed-exception livelock | `core/orchestrator.py:532,534` | Critique prompt references `browser_response.data` / `ss_analysis_response` even when the actor raised and the name was never assigned → `UnboundLocalError` swallowed by an outer `continue` → **livelock** | **Lesson:** never let an exception inside the verification path be swallowed by a loop `continue` | `engine/steps/VerifyStepHandler.java` |
| TheAgenticBrowser | Context hygiene | `core/orchestrator.py:99-167` | Bulky intermediate payloads (DOM) replaced by a short placeholder (`"DOM successfully fetched"`) in the history passed to the critic and back to the actor | **PORT (concept only)** — token-control technique; store large artifacts out-of-band | `ai-service/app/llm/context.py` |
| TheAgenticBrowser | Tool trace + history integrity | `core/orchestrator.py:52-92,23-48` | Extracts a tool trace for the critic; asserts every tool call has a matching return before planning continues | **PORT (concept only)** | `backend/.../engine/StepTrace.java` |
| TheAgenticBrowser | Independent verification principle | `core/utils/ss_analysis.py:47-123` | Before/after screenshot diff rather than trusting the actor's self-report | **IGNORE** the mechanism — but the principle (*verify with independent evidence, not self-report*) is exactly what our tool-observed-URL rule implements | — |
| TheAgenticBrowser | Task registry + SSE | `core/server/api_routes.py:37,96-183` | In-process dict registry, SSE streaming, cleanup, duplicate task ids rejected with 400 | **PORT (concept only)** — same UX contract, backed by MySQL job state, never an in-process dict | `backend/.../monitoring/` |
| TheAgenticBrowser | ~~Browser agent~~ | `core/agents/browser_agent.py`, `core/skills/**`, `core/utils/get_detailed_accessibility_tree.py`, `core/browser_manager.py` | Playwright agent, 10 DOM tools, `mmid` attribute injection, class-attribute-singleton browser manager with GUI overlay + video recording, `WORKERS=1` | **IGNORE** — not building an interactive browser agent; Firecrawl `interact` covers page interaction | — |
| TheAgenticBrowser | ~~Pins~~ | `requirements.txt:83-84` | `pydantic-ai==0.0.17` alpha, ~2 years stale, API radically changed | **IGNORE** | — |

---

## C.5 `anakin-master` — **AGPL-3.0: concepts only, no code**

`NOTICE:1-4` states AGPL-3.0; its network-use clause would copyleft the entire product. **Zero
files may be copied or translated**, including `init-db.sql`. Everything below is
**PORT (concept only)**.

Important correction to the brief's assumption: **anakin has no database-backed queue and no claim
mechanism.** Its "queue" is an in-process Go channel (`worker/worker.go:20-36,60-62`); Postgres is
only a state/result store. It is single-instance by design (`README.md:47`: "no Redis, no AWS, no
message queues"). So "adapt anakin's job architecture to MySQL" means **adding the durability
layer anakin itself lacks**.

| Repository | Useful feature | Source path | Actual implementation | Method | Destination |
|---|---|---|---|---|---|
| anakin | Job table column set | `scripts/init-db.sql:2-23` (`scrape_requests`) | `id, job_type, url, status, payload, cached, html_length, success, error, result, duration_ms, parent_job_id, created_at, completed_at`; indexes on `status`, `parent_job_id`, `created_at`, `url`. **No lease, attempt, or version columns** | **PORT (concept only)** — independently authored MySQL DDL for the same *information*. **Add what anakin lacks:** `attempt_count`, `max_attempts`, `next_retry_at`, `locked_at`/`lease_expires_at`, `worker_id`, `version`, `updated_at`; `ENUM` status with service-layer transition enforcement | `db/migration/V1__baseline.sql` → `workflow_jobs` |
| anakin | Per-domain policy table | `scripts/init-db.sql:26-49` (`domain_configs`) | `handler_chain`, `request_timeout_ms`, `max_retries`, `min_content_length`, `failure_patterns`/`required_patterns` (regex CSV), `custom_headers`, `custom_user_agent`, `blocked`/`blocked_reason` | **PORT (concept only)** — an excellent model for per-source governance config | `db/migration/…` → `source_domain_policy` |
| anakin | Status vocabulary | `models/types.go:11-22` | `pending → processing → completed \| failed`; job types | **PORT (concept only)** — extended to the brief's 7 states (`PENDING, RUNNING, COMPLETED, FAILED, SKIPPED, BLOCKED, CANCELLED`) | `domain/enums/JobStatus.java` |
| anakin | ⚠️ Unguarded status | `models/types.go:11-16` + `store/postgres.go:29-31,106-128` | Status is a bare `VARCHAR(20)` with **no CHECK and no transition guard anywhere** — enforcement is purely procedural | **Lesson: do the opposite** — MySQL `ENUM` + explicit transition table + `WHERE status = <expected>` on every UPDATE | `domain/enums/`, `engine/` |
| anakin | Pool sizing + backpressure | `worker/worker.go:19-69` | `WORKER_POOL_SIZE`=5, bounded buffer `JOB_BUFFER_SIZE`=100 (a blocking channel send stalls the HTTP request = natural backpressure), per-job `context.WithTimeout` (`JOB_TIMEOUT`=120s), `Drain()` on shutdown | **PORT (concept only)** — maps 1:1 onto Spring | `config/AsyncConfig.java` → `ThreadPoolTaskExecutor(corePoolSize, queueCapacity, CallerRunsPolicy)` + `@PreDestroy` drain + `SmartLifecycle` phases |
| anakin | ⚠️ **No DB claim exists** | *(absent)* — `worker.go:60-62`, `scraper.go:59-67` | Double-processing is prevented only because a Go channel delivers each message once *within one process*. Grep confirms **no `FOR UPDATE`, no `SKIP LOCKED`, no advisory lock, no version column** anywhere in `server/` | **REIMPLEMENT** — this is the gap. MySQL `FOR UPDATE SKIP LOCKED` or an atomic conditional `UPDATE`; SQL in `J` | `engine/JobClaimRepository.java` |
| anakin | ⚠️ **No recovery** | *(absent)* | No heartbeat, no stale-job recovery, no requeue sweeper. On crash, buffered/in-flight messages are lost and rows stay `pending`/`processing` forever | **REIMPLEMENT** — lease column + sweeper resetting expired `RUNNING` → `PENDING` | `engine/StaleJobRecoveryTask.java` (`@Scheduled`) |
| anakin | **`persistCtx` terminal writes** | `processor/processor.go:24-33` | Terminal-state writes use `context.WithoutCancel(ctx)` + a fresh 5s timeout, because the job context is already expired when failure is recorded — otherwise "a job that timed out stays stuck in 'processing' forever" | **PORT (concept only)** — the most valuable operational insight in the repo. Final-state writes must never share the cancelled job's transaction/context | `engine/JobFinalizer.java` with `@Transactional(REQUIRES_NEW)` |
| anakin | Executor flow | `processor/processor.go:65-92,94-275,287-328` | mark processing → handler chain → validate content → convert → store result → completed; `handleFailure` → failed | **PORT (concept only)** — cleanest end-to-end executor template found in any of the four repos | `engine/WorkflowExecutor.java` |
| anakin | ⚠️ Retry loop | `processor/processor.go:139-179` | Per-attempt loop inside one execution: `maxRetries=1` default (2 attempts), per-domain override (default 2 → 3), **no backoff** (immediate retry), also retries on content-validation failure. Count lives **only in a loop variable** — never persisted; a failed job is terminal and never requeued. `MAX_JOB_RETRIES` env exists (`config.go:26,64`) but is **dead config, never referenced by the processor** | **PORT (concept only) + fix all three defects**: persist `attempt_count`, exponential backoff **with jitter**, schedule `next_retry_at` so a failed job can be re-driven | `engine/RetryPolicy.java` |
| anakin | Content-quality gate | `domain/detector.go:27-81` | Deterministic check: minimum length, failure-pattern regex match, required-pattern absence — each carrying a `ShouldRetry` flag | **PORT (concept only)** — cheap pre-LLM gate complementing the LLM VERIFY step. Precompile the regexes (their `TODOS.md:14-22` admits the perf gap) | `governance/ContentQualityDetector.java` |
| anakin | Batch parent/child | `http/handlers/scraper.go:236-301` + `store/postgres.go:136-174` | Validate 1–10 URLs → insert **parent** row (`job_type=batch_url_scraper`) → one **child per URL** with `parent_job_id`; children are ordinary jobs, the parent is never "executed". Rollup via `COUNT(*) FILTER (WHERE status=…)` over children | **PORT (concept only)** — same-table parent/child with count rollup is right for per-source fan-out. **Fix the race:** anakin reads then writes without locking the parent; use one atomic `UPDATE … WHERE NOT EXISTS (…)` or lock the parent `FOR UPDATE` | `engine/BatchFanout.java`, `workflow_jobs.parent_job_id` |
| anakin | Derived batch status on read | `http/handlers/scraper.go:303-380` | Recomputed from children on every poll | **PORT (concept only)** — good for a responsive UI; never the source of truth | `api/RunQueryService.java` |
| anakin | Hybrid sync/async UX | `http/handlers/scraper.go:82-189` | Polls the store every **500ms** until terminal or deadline (default 30s, max 120s); on timeout returns **408 with the job id and instructions to keep polling async** | **PORT (concept only)** — best-in-class sync/async UX | `api/` optional convenience endpoint |
| anakin | Async submit conventions | `http/handlers/scraper.go:191-234` + `docs/API.md:112-231,597-631` | Submit → `201 {id, status:'pending'}`; `GET /:id` returns the full result once complete; error envelope `{error, message}`; documented polling guidance (1s initial wait, poll 1–2s, client timeout 60–120s) | **PORT (concept only)** — our `202 {runId}` + poll/SSE matches | `api/` conventions |
| anakin | Internal API-key auth | `http/router/router.go:41-63,74-112` | Constant-time compare; accepted as `X-API-Key`, `Api-Key`, or `Authorization: Bearer`; write routes always require a key, `GET /health` never does | **PORT (concept only)** — exactly what the Spring→Python internal boundary needs | `security/InternalApiAuth.java` |
| anakin | Dial-time SSRF guard | `http/handlers/scraper.go:390-410`, `netguard/netguard.go`, `handler/http.go:40-48` | Scheme/host validation + rejection of loopback/private/link-local (incl. cloud metadata `169.254.169.254`) unless explicitly allowed, **plus a dial-time guard against DNS rebinding and redirects** | **PORT (concept only)** — the old TS project already has an equivalent (`SourceValidator.ts:84+`, `:226-234`), so port from there; anakin independently confirms the dial-time check is necessary | `governance/SsrfGuard.java` |
| anakin | Handler chain of responsibility | `handler/chain.go:25-78`, `docs/handlers.md:5-22` | HTTP → Browser → optional API, each tried once per attempt, gated by `CanHandle`/`IsHealthy`, aggregated error `all handlers failed: <lastErr>`; 10 MB body cap | **PORT (concept only)** — ordered `List<CollectionHandler>` beans with `canHandle/isHealthy/collect` | `ai-service/app/firecrawl/` strategy chain (scrape → interact fallback) |
| anakin | Domain-config cache | `domain/cache.go:14-72,74-80` | 60s refresh ticker; exact-host match then parent-domain match | **PORT (concept only)** | `governance/DomainPolicyCache.java` (`@Scheduled(fixedDelay=60s)` + `ConcurrentHashMap`) |
| anakin | LLM as optional enrichment | `processor.go:207-222`, `gemini/client.go` | Extraction failure sets `generatedJson.status='failed'` **without failing the job** — non-blocking enrichment | **PORT (concept only)** — sensible degradation policy | `engine/steps/ExtractStepHandler.java` |
| anakin | Pool/timeout/shutdown ordering | `cmd/server/main.go:59-61,134-141,182-210` | DB pool (MaxOpen 25 / MaxIdle 5 / ConnMaxLifetime 5m); HTTP timeouts (read/write 30s, idle 120s, body 10 MB); shutdown: stop ingress → cancel background → drain workers → stop subsystems | **PORT (concept only)** | `config/` + `SmartLifecycle` phases |
| anakin | Sidecar watchdog | `browser-service/server.py:42-44,60-87,160-221` | Subprocess supervisor restarting the browser with exponential backoff 1s→30s; health endpoint 200/503 by state; graceful terminate → kill escalation | **PORT (concept only)** — process supervision pattern for the FastAPI service | `deploy/` |
| anakin | Job monitor UX | `webapp/src/hooks/useJobs.ts`, `webapp/src/pages/JobDetail.tsx:42-59`, `Jobs.tsx:14-26` | `setInterval(…, 2000)` polling until terminal; localStorage job history | **PORT (concept only)** — as the **fallback** when SSE is unavailable | `frontend/hooks/` |
| anakin | ~~Proxy bandit~~ | `proxy/pool.go`, `proxy/sampler.go:39-109`, `init-db.sql:52-62` | Thompson Sampling: Beta(α,β) priors via Marsaglia-Tsang Gamma sampling, success → α++, latency EMA 0.2, failure → β++, 403-blocked → β+=10 plus a 5-minute per-domain block, UPSERT every 60s | **IGNORE** unless we run a proxy fleet. If we ever choose among LLM providers or collection routes, this is a self-contained bandit worth remembering | — |
| anakin | ~~Memory fallback / telemetry~~ | `store/memory.go:14-22`, `telemetry/**`, `TELEMETRY.md` | In-memory store fallback; vendor telemetry | **IGNORE** | — |
| anakin | Compose topology | `docker-compose.yml:1-47` | healthcheck-gated `depends_on` | **PORT (concept only)** — Postgres→MySQL, add `ai-service` and `frontend`, keep healthcheck gating | `deploy/docker-compose.yml` |

**Also note:** anakin is **PostgreSQL** (`lib/pq`, `store/postgres.go`), so its DDL uses
`UUID`/`gen_random_uuid()`, `TIMESTAMP WITH TIME ZONE`, and `COUNT(*) FILTER (WHERE …)` — none of
which is MySQL syntax. Even setting licensing aside, its schema would need translation, not
adoption.

---

## C.6 Reuse totals

| Repository | License | Code copied | Concepts ported | Dropped |
|---|---|---|---|---|
| Old project (`AI-Powerd Data Intelligence`) | proprietary (yours) | 0 files verbatim; schema + contracts + pipeline **ported** | ~40 components | entire `demo/` tree, silent fallbacks, fabricated route defaults, BullMQ/Redis layer, vendored TS core, hand-written OpenAPI, stale `Architecture.md`/`Design.md` |
| `web-agent-main` | MIT | prompt content + `structured-extraction` SKILL.md (**DIRECT COPY**, with provenance) | `schema-validate`, the two enforcement gates, toolkit gating, event/tool-result shapes, compaction (deferred), skills loader (deferred) | LangChain/deepagents harness, vendoring, Express template (kept as documented fallback) |
| `web-research-agent-master` | MIT | 0 files verbatim | 2 prompts, retry backoff formula, chunking params, ranking algorithm (adapted) | ephemeral Chroma, scraper, aggregator code, Azure/CSE wiring, mock test |
| `TheAgenticBrowser-main` | Community License | **0 — prohibited** | 8 patterns (critique loop, feedback→replan, termination thresholds, context hygiene, tool trace, task registry+SSE) | browser agent, DOM skills, Playwright manager, alpha pins |
| `anakin-master` | AGPL-3.0 | **0 — prohibited** | 14 patterns (job schema information, lifecycle, pool/backpressure, `persistCtx`, executor flow, batch rollup, sync-poll UX, content detector, handler chain, SSRF, caching, shutdown ordering, sidecar watchdog, polling UX) | proxy bandit, memory store, telemetry |

**No reference repository is a runtime dependency.** Nothing in `FINALAIAGENT` imports from any of
the four. See `N-scripts-and-dependencies.md` for the old project's toolchain state, and
`00-FORENSIC-AUDIT.md` §7 for the licensing detail behind C.4 and C.5.

## C.7 Two further repositories (added at Phase 1.5)

`data-enrichment-js-main` and `ai-data-enrichment-agent-main` were inspected after Phase 1. Their
reuse rows use the same six columns and live in
[`O-new-repositories-integration-analysis.md`](O-new-repositories-integration-analysis.md) §O.7,
kept separate rather than merged here because both carry an unresolved licence question (§O.11 R28,
R29) that every row in `C` already answers definitively.
