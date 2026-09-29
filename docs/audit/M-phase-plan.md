# M. Phase Plan

**Discipline rule (carried forward from `Phases.md:97`):** do not start a phase until the previous
phase's exit criteria are met and recorded in `docs/control/Memory.md`. Do not implement a later
phase's features early. Every phase must leave the project runnable and verifiable.

**Per-phase loop:** read the control docs → read `Memory.md` → inspect current target code →
inspect the relevant reference source → compare → plan → implement **only that phase** → test →
typecheck → build → update `Memory.md` → **stop and report**.

---

## Phase 0 — Forensic audit ✅ COMPLETE

This document set. No signed-off application code. Deliverables A-N produced, plus the findings
report `00-FORENSIC-AUDIT.md` and the executed toolchain audit `N-scripts-and-dependencies.md`.

**Two decisions are required before Phase 1 begins:**

| Gate | Question | Options |
|---|---|---|
| **G1** (`L` R8) | With `DEMO_MODE` gone, how will you demonstrate this to judges? | (a) test-fixture mode + run replay *(recommended)*, (b) guarded `SYNTHETIC_MODE` that can never trigger on a missing key, (c) funded keys and demo live |
| **G2** (`L` R16) | Confirm the Python Firecrawl SDK's `interact` is sufficient | resolved by the Phase 2 spike; fallback is the Express sidecar (a fourth runtime, needing its own recorded decision) |

Also required before Phase 1: install **Python 3.12** (3.14.6 is present but too new), and note
that **Docker is unavailable**, so integration tests run against the native MySQL 9.6 service.

---

## Phase 1 — Foundation & skeleton ✅ COMPLETE (narrowed scope — see result below)

**Goal:** three runnable processes, one database, zero features.

- Repo layout per `C` §C.0. Maven multi-module Spring Boot (Java 21); FastAPI app skeleton;
  copy the PirateAgentUI **design foundation only** (`D` §D.2 — CSS, Tailwind config, fonts,
  `components/ui`, `components/icons`, `components/common`, layout shell, landing, images).
- Flyway `V1__baseline_identity.sql` … `V6__export.sql` (all 21 tables, per `E`).
- Fail-fast configuration: `@ConfigurationProperties` + Pydantic settings asserting every
  required credential in `K` is present and non-empty, JWT secrets ≥32 chars and distinct, and
  the two `AI_SERVICE_API_KEY` values equal. **Absent credential ⇒ non-zero exit.**
- `GET /health`, `GET /ready` (MySQL reachable, AI service reachable, credentials present),
  `GET /ai/v1/health` (reports the truth about key presence).
- Internal auth on the Python boundary (`X-API-Key`, constant-time).
- Single root `.env.example`; `.env` gitignored; logging with secret masking on both sides.
- `docker-compose.yml` in `deploy/` — mysql 8.4 + backend + ai-service + frontend, **no redis**,
  one documented port per service, `FRONTEND_ORIGIN` matching the real Next.js origin, no
  insecure secret defaults.

**Exit criteria:** `mvn verify` and `pytest` pass; `next build` succeeds; Flyway migrates a clean
`finalagent_dev`; all three processes start and `/ready` returns 200; **deleting any required
env var makes the relevant process refuse to start** (test this explicitly — it is the inversion
of the old project's core defect).

### Phase 1 result — 2026-09-29 ✅ (scope narrowed by instruction)

Built and measured: `backend/` (Spring Boot 3.5.16, Java 21), `ai-service/` (FastAPI),
`frontend/` (Next.js 14 with the PirateAgentUI design foundation copied verbatim),
`database/`, `deploy/`, `scripts/`, root `.env.example`.

| Criterion | Outcome |
|---|---|
| `mvn test` | **27 passed**, 0 failures |
| `pytest` | **31 passed** |
| `next build` / `typecheck` / `lint` | passed, 13 pages; all 10 routes served by `next start` |
| Three processes start independently | passed via `scripts/dev-*.sh` |
| Full chain browser → Next → Spring → FastAPI | passed — `aiService: UP` over the `X-API-Key` boundary |
| Missing env var ⇒ refuse to start | **passed, tested explicitly on both services** (exit 1, variables named, values never printed) |
| MySQL connection **configuration** loads | passed — properties bind, driver reaches the server, `/ready` names the failure reason |
| `/ready` returns 200 | **not achieved** — needs a real MySQL account matching `MYSQL_USER`. Reported as unmet rather than faked |
| Liveness independent of MySQL | passed — `/actuator/health/liveness` stays `UP` while readiness is `DOWN` |

**Deferred, and where it goes:** Flyway V1–V6 + the 21 tables, and JPA entities → the schema
phase; Spring Security, JWT issuance and refresh-token storage → Phase 3; `source_domain_policy`
and governance → Phase 7; PRD/Rules/Phases control docs → Phase 2. Docker images are written but
unbuilt (Docker is absent). Provider SDK dependencies are held in the `collection` extra until the
Phase 2 spike.

**Two corrections to this plan as written:** the AI service needs no CORS layer (it is internal,
Host-restricted and key-authenticated, and the browser never reaches it), and `NEXT_PUBLIC_API_URL`
is not needed at all once the Next.js rewrite exists — see `K` §K.5.

---

## Phase 2 — Provider spike (decision gate G2) ✅ DONE AS INTEGRATION; SPIKE STILL OWED

**Actual Phase 2 (2026-09-29), by instruction:** the data-enrichment core integration —
`data-enrichment-js`'s research graph ported into `ai-service/app/research/` against Firecrawl, with
`POST /ai/v1/research` and the Spring passthrough. Measured: **74 pytest passed**, **37 mvn tests
passed**, live Spring→Python call verified (422 propagation; Java-side rejection with
`verifyNoInteractions`). Decision **L2** resolved — plain Python state machine, no `langgraph`
dependency.

**Deferred, still owed:** the provider spike below. It could not be honest without a
`FIRECRAWL_API_KEY`, and a real Gemini call would bill the account, so `graph.py` is verified
against doubles only and `tests/test_live_provider_spike.py` stays skipped until
`RUN_LIVE_PROVIDER_TESTS=true`. **G2 therefore remains open**, narrowed by the discovery that
`AsyncFirecrawlApp.interact(job_id, …)` takes a job id rather than a URL.

**Original goal:** prove the external dependencies work before building on them. Deliberately tiny.

- `ai-service/app/firecrawl/client.py`: one module owning the SDK, async, semaphored, per-call
  timeout. Call `search`, `scrape`, and `interact` against a real key and record the actual
  response shapes.
- `ai-service/app/llm/client.py`: Gemini structured output with a `response_schema` from a
  Pydantic model; verify the `const`-keyword workaround; confirm `temperature=0`.
- Record credit/token consumption for one search + three scrapes + one interact, so cost
  expectations are grounded in measurement rather than assumption.

**Exit criteria:** all three Firecrawl operations return usable data; Gemini returns a
schema-conformant object; **G2 resolved in writing** — either "Python SDK is sufficient" or
"invoke the sidecar fallback", with the evidence. A gated test (`RUN_LIVE_PROVIDER_TESTS=true`)
captures this and is skipped by default.

---

## Phase 3 — Authentication & tenancy

**Goal:** everything after this is scoped to an authenticated user and workspace.

- Spring Security resource server, JWT access (15 min) + rotating refresh (7 d) with `jti`.
- `refresh_tokens` persistence, revocation as a row update, **reuse detection**, scheduled purge.
- Register (bcrypt + atomic user/workspace/OWNER membership), login, logout, refresh, me.
- `WorkspaceAccessEvaluator` (role ranks OWNER > ADMIN > MEMBER) and `IdentityGuard`
  (client-supplied identity that contradicts the token ⇒ `403 FORBIDDEN_USER_MISMATCH`).
- **Mount them.** Method-level `@PreAuthorize` on services so a missing controller annotation
  still fails closed. Workspace is resolved from the principal, never trusted from a query param.
- `user_preferences` GET/PUT (the current settings page saves nothing).
- API rate limiting: auth 15/min, workflow 30/min, 429 + `Retry-After`.

**Exit criteria:** an unauthenticated request to any business route returns 401; a user from
workspace A requesting workspace B's resource returns 403/404 — asserted by an integration test
**per resource type**; a revoked refresh token is rejected and its reuse is recorded; **no
default or fallback secret exists anywhere** (grep-asserted).

---

## Phase 4 — Requirement understanding

**Goal:** a prompt becomes a validated Requirement contract, dynamically.

- `ai-service`: `contracts/requirement.py` (Pydantic, **authoritative**), `llm/prompts/
  requirement.md` (ported, incl. the "user text is untrusted data" framing), structured output,
  semantic validation (requiredFields ⊕ optionalFields), derived `validationStatus`.
- `backend`: `RequirementContract` Bean Validation mirror + a JSON-Schema **contract test**
  asserting Java and Python agree on the same fixtures.
- `POST /api/v1/requirements/parse` → 200 with the contract, or **422
  `REQUIREMENT_NEEDS_CLARIFICATION`** with the questions. No defaults for `entity` or
  `targetCount`.

**Exit criteria (the anti-hardcoding test):** three structurally different prompts — e.g.
*"find best youtube channels for coding"*, *"find 100 AI startups in India founded after 2020
with founder, funding and website"*, *"find remote frontend developer jobs in India with salary
and application URL"* — produce three contracts with **different `entityType`, different field
sets, and different filters**, asserted field-by-field in a test. Assert additionally that
**no response contains `company_name`/`founder`/`funding` unless the prompt asked for them**,
and that a fourth unrelated prompt (*"find technology sponsors for a college hackathon"*) again
differs. Malformed model output yields 422/502, never a default contract. Grep the codebase to
prove no keyword matcher or scenario table exists.

---

## Phase 5 — Workflow planning

**Goal:** a Requirement becomes a validated, persisted, versioned plan DAG.

- `ai-service`: `contracts/plan.py`, `llm/prompts/plan.md`, generation with the fixed step
  vocabulary.
- `backend`: `WorkflowPlanValidator` enforcing every bound in `F` §F.4 — 2-30 steps, vocabulary,
  dependencies reference earlier steps, ≥1 EXTRACT and ≥1 SAVE, retry/timeout bounds,
  `maxRequestsPerDomainPerMinute ≤ 60`, extraction schema with `additionalProperties:false`,
  plan↔requirement field agreement. **Safety literals are Java constants**, not model output.
- 2-attempt validate→correct loop feeding issues back; second failure persists
  `planning_status=FAILED` with a sanitized code.
- `workflows` + `workflow_plans` persistence, immutable once written, `plan_hash`.
- `POST /api/v1/workflows/plan`.

**Exit criteria:** the four prompts above yield **different step sequences** (at least two
distinct shapes), asserted in a test. An invalid plan (cycle, unknown step type, missing SAVE,
`maxAttempts=9`, a model attempting `allowAuthentication=true`) is rejected with the specific
reason. A rejected-then-corrected plan is persisted at `version=2` with version 1 retained.

---

## Phase 6 — Job engine (no Redis)

**Goal:** durable asynchronous execution on MySQL alone.

- `workflow_jobs` claim via atomic conditional UPDATE **and** `FOR UPDATE SKIP LOCKED` batch
  claim; the composite index; short claim transactions.
- Lease + heartbeat (renew at `lease/3`; abort if `version` changed), stale-recovery sweeper,
  retry with exponential backoff **plus jitter**, `retryableErrors` whitelist.
- `ThreadPoolTaskExecutor` with bounded queue and `CallerRunsPolicy`; `@Scheduled` claim poller
  with adaptive backoff; per-step Resilience4j `TimeLimiter`.
- **Terminal writes in `REQUIRES_NEW`** (anakin's `persistCtx` lesson).
- Parent/child batch fan-out with **atomic** rollup.
- Cooperative cancellation at step boundaries; unstarted jobs moved to `CANCELLED`.
- Idempotency: unique intent keys, `WHERE status=<expected> AND version=<expected>`, skip
  already-completed steps on reclaim.
- Graceful shutdown via `SmartLifecycle` phases, **releasing leases** so another node resumes
  immediately.
- `POST /api/v1/workflows/execute` → 202; `GET /runs/{id}`, `/runs/{id}/steps`,
  `POST /runs/{id}/cancel`. Steps execute against a **stub** collector for now.

**Exit criteria:** a run enqueued and executed end-to-end against stubs, with every step
persisted and `progress` derived from real step state. **Kill the JVM mid-run and restart: the
lease expires, the job is reclaimed, and the run completes** (this is the test the old
architecture would fail). Two concurrent pollers never both execute the same job (assert with a
counting stub). A failing step retries with observable backoff, then terminates as `FAILED` with
a persisted reason. Cancellation takes effect at the next boundary.

---

## Phase 7 — Source governance

**Goal:** nothing is collected without passing policy, and every decision is recorded.

- `SsrfGuard` (RFC1918, loopback, CGNAT, link-local/metadata `169.254.169.254`, IPv6 forms,
  single-label hosts, internal TLDs) + DNS preflight against rebinding.
- `source_domain_policy` resolution (exact host → parent domain → platform default), 60s cache.
- `RobotsPolicyService`: configurable UA, UA-group parsing, allow/disallow specificity,
  crawl-delay, per-origin cache, bounded response size, **fail closed**.
- `DomainRateLimiter` (Bucket4j, fail closed, robots crawl-delay as floor).
- `SourceRelevanceRanker` (ported weights, now configuration; add a score floor, zero-norm guard,
  domain diversity).
- `SourceGovernanceService` lifecycle `DISCOVERED → ALLOWED → QUEUED → PROCESSING →
  COLLECTED | BLOCKED | SKIPPED | FAILED`, with reasons and sanitized errors.
- `POST /ai/v1/collect/search` + `GET /api/v1/sources`, `GET /api/v1/sources/{id}`.

**Exit criteria:** a deliberately disallowed test source is `BLOCKED` with the robots reason
persisted and never reaches Python; a private/metadata URL is rejected by the SSRF guard
(unit-tested across every address class); the per-domain budget is honoured including
crawl-delay; relevance ranking is deterministic and the score is persisted. **No source is ever
fetched that governance did not clear** — asserted by a test that fails if Python receives an
uncleared URL.

---

## Phase 8 — Collection & extraction

**Goal:** cleared URLs become schema-conformant records with real evidence.

- `ai-service`: `firecrawl/client.py` (async, allowlisted tools, per-URL isolation, `interact`
  60s-capped and never in parallel fan-out), `extraction/schema_validate.py` (the ported
  single validator), `extraction/gate.py` (`MAX_SCHEMA_REPAIRS=3` + **no answer before data**),
  `llm/prompts/extract.md`, markdown truncation limits.
- `POST /ai/v1/collect/extract` returning `records`, `sources`, **`observedSourceUrls`**,
  `schemaMismatch`, `execution{provider, model, durationMs, tokens, toolCallCount, toolsUsed}`.
- `backend`: `EvidenceIntegrity` — keep only tool-observed URLs; model-claimed URLs get
  `verified_by_tool=false`; records with no observed source become `SOURCE_EVIDENCE_UNVERIFIED`.
- SCRAPE / INTERACT / EXTRACT step handlers wired into the engine.

**Exit criteria:** a live run (gated test) produces records each with ≥1 tool-observed source.
A **fabricated-URL test** — the model returns a plausible URL that no tool ever visited — asserts
it is marked unverified and cannot become evidence. A malformed-extraction test asserts repair
succeeds within 3 attempts and **fails cleanly after**, never returning approximate data. A
"no data collected" test asserts the gate rejects a complete-looking result. Token usage is
persisted per step.

### Delivered early — session Phase 2, 3 and 4 (2026-09-29)

Most of this phase was built ahead of the plan's order, under different names. Correcting the
names here matters: the plan's `extraction/gate.py`, `llm/prompts/extract.md` and
`POST /ai/v1/collect/extract` **do not exist**, and nothing above is wired into a job engine.

| Planned | Built as | State |
|---|---|---|
| `firecrawl/client.py` — async, allowlisted tools, per-URL isolation, `interact` 60 s-capped and never in parallel fan-out | same path; `allowed_web_tools` ceiling + `resolve_limits()`, `ToolOutcome` per-call isolation, `FirecrawlWeb.interact()` with `interact_timeout_seconds` (60 s) and a refusal inside `execute_many()` | **done**, verified against a stub SDK client; never against the live API |
| `extraction/schema_validate.py` — the ported single validator | same path | done (Phase 2) |
| `extraction/gate.py` — `MAX_SCHEMA_REPAIRS=3` + no answer before data | `app/research/graph.py` gates 1 and 2, with `state.repair_attempts` and `has_tool_data()` | done, not a separate module |
| markdown truncation limits | `MARKDOWN_TRUNCATE_CHARS`, applied to scrape and interact output | done |
| `records` + `sources` + `observedSourceUrls` + `schemaMismatch` + execution metadata | `POST /ai/v1/research` → `{status, records[], sources[], metadata{…interactionsUsed, enabledTools, playbooksUsed}, validation{missingFields, extraFields, unverifiedUrls, …}}` | done, under different field names; `metadata.toolsUsed`-style naming became `enabledTools` + per-tool counters |
| `EvidenceIntegrity` — keep only tool-observed URLs; model-claimed URLs get `verified_by_tool=false` | Python side done: `SourceObserved.verified_by_tool`, `_record_provenance()` | done in `ai-service`; **the Java-side enforcement the plan describes is not built** |
| SCRAPE / INTERACT / EXTRACT step handlers wired into the engine | — | **not started**: there is no job engine (plan Phase 6) and no step table |
| `llm/prompts/extract.md` | `app/research/prompts/{research,submit,critique}.md` | done differently: the extraction turn is `submit.md`, driven by the caller's schema |
| Token usage persisted per step | — | not started; `metadata` carries loops/searches/scrapes/interactions/durationMs, **no token counts**, and there is nowhere to persist them yet |

Still owed by this phase after the engine exists: the live gated run, the fabricated-URL test as a
Java-persistence assertion, and token accounting.

---

## Phase 9 — Data intelligence pipeline

**Goal:** raw records become a trustworthy, deduplicated, conflict-preserving set.

- `ai-service/app/quality/`: normalize (aliases, whitespace, URL, date, numeric, currency,
  phone, country via a static ISO-3166 table), validate (type/required/format/enum/country;
  unimplemented RANGE/CUSTOM **downgraded to WARNING, not faked**), deduplicate (blocking index,
  EXACT/NORMALIZED, duplicates **linked never deleted**), entity resolution (legal-suffix
  stripping, identifier blocking, Levenshtein, threshold 0.94, merge only with a shared stable
  identifier), score (the documented heuristic, labelled as such).
- `POST /ai/v1/quality/process`; TRANSFORM / VALIDATE / DEDUPLICATE / MERGE step handlers.
- **Java re-enforces** required fields, types and evidence presence before anything is persisted.
  Python's output is advisory.

**Exit criteria:** a fixture batch containing deliberate duplicates ("OpenAI" vs "Open AI Inc."),
a malformed email, an invalid URL, a missing required field, and two sources disagreeing on a
value produces: duplicates linked to a canonical row, invalid fields flagged with reasons, the
conflict **preserved and visible** (not silently resolved), and quality metrics populated. No
value is invented and no uncertain record is deleted. Every rejection is recorded, never skipped
silently.

---

## Phase 10 — Dataset persistence & querying

**Goal:** results are durable, dynamic and queryable.

- `SAVE` step: one transaction writing dataset, `dataset_columns`, `dataset_rows`,
  `source_evidence`, `validation_issues`, `deduplication_events`, `data_quality_reports`.
  Idempotent on replay (dataset keyed on the unique `workflow_run_id`). Rows without evidence are
  **rejected and recorded**, not skipped.
- `search_text` maintained for the FULLTEXT index.
- `GET /datasets`, `/datasets/{id}`, `/schema`, `/rows` (server-side pagination, sort, search,
  `validOnly`, `includeDuplicates`, `verificationStatus`, confidence range, `sourceId`,
  `filter[<key>]`), `/rows/{rowId}`, `DELETE`. Filter/sort keys validated against
  `dataset_columns` before reaching SQL. `GET /stats` with true workspace totals.

**Exit criteria:** after a full run, a dataset with linked rows and evidence is queryable
independently of the AI service. A JSON-path/SQL injection attempt through `filter[...]` is
rejected. Search uses the FULLTEXT index (assert with `EXPLAIN`). Confidence is nullable and a
missing value is returned as `null` — never 90.

---

## Phase 11 — Provenance & evidence explorer

**Goal:** every record is explainable.

- `SnippetVerifier` (a snippet corroborates a value only if the value's tokens literally appear
  in it, else `is_verified=false`), `ProvenanceService.buildRowEvidenceExplorer`, multi-source
  row provenance, conflict history.
- `GET /datasets/{id}/sources`, `GET /sources/{id}`, `GET /rows/{rowId}/evidence` (+ dataset-scoped
  alias). **The top-level alias takes only `rowId`**, resolved through the authenticated
  workspace, so the old 3-arg/4-arg arity bug cannot recur.

**Exit criteria:** a row draws evidence from two different sources for two different fields and
both are shown correctly. A snippet that does not contain the value returns
`is_verified=false`. Conflicting values remain visible with their review decision. Every row in
every dataset has ≥1 evidence link, asserted by an integrity test.

---

## Phase 12 — Monitoring: activity events & SSE

**Goal:** a run is observable live and replayable afterwards.

- `ActivityEventPublisher`: persist to `activity_events` **before** broadcast, with
  server-composed `message` text.
- Canonical action enum — **one name per event**; the frontend's
  `DEDUPLICATION_COMPLETED`/`DEDUP_COMPLETED` hedge is removed, and `RECORDS_COLLECTED` is
  dropped as a synonym.
- `GET /runs/{id}/events` (SSE): replay honouring `Last-Event-ID`, live streaming via an
  in-process emitter registry, `: ping` every 15s, close on terminal status.
- **Stream tickets**: `POST /runs/{id}/stream-ticket` issues a short-lived single-use ticket so
  the JWT never appears in a URL.
- `GET /activity` (workspace-global) to remove the N+1 loop.
- Authoritative `progress`, `stage`, `displayStatus` on run and workflow DTOs.

**Exit criteria:** a browser watching a live run receives ordered events with no gaps; killing
and restarting mid-run, then reconnecting with `Last-Event-ID`, replays the missed events
correctly; the terminal event closes the stream; no token appears in any request URL or log.

---

## Phase 13 — Export

**Goal:** data leaves the platform in three formats, via real queued jobs.

- `EXPORT` becomes a real step (the old runner always returned `SKIPPED`).
- Queued `export_jobs` with lease + recovery; chunked streaming writers (RFC 4180 CSV, streamed
  JSON array, POI SXSSF XLSX); SHA-256 + file metadata; `expires_at` **enforced** by the sweeper;
  path-traversal containment on download.
- Full-dataset, filtered-subset and selected-column exports.
- `POST /datasets/{id}/exports`, `GET /exports/{id}`, `GET /exports/{id}/download`.

**Exit criteria:** exporting a filtered view in all three formats yields files matching the
filtered rows exactly; CSV quoting survives embedded commas, quotes and newlines (RFC 4180 test);
the checksum verifies; **restarting mid-export recovers or fails the job rather than stranding it
in `RUNNING`**; an expired job is swept and its file removed; a traversal path is rejected.

---

## Phase 14 — Frontend integration

**Goal:** the preserved PirateAgentUI renders only real data.

- Copy the design foundation (already done in Phase 1) and wire every screen per `D` §D.3.
- Replace `use-api.ts` with TanStack Query (caching, invalidation, polling fallback when SSE
  drops); add reconnect/backoff to `use-sse.ts`; add `next-themes` so the existing `.dark`
  palette becomes reachable; env-driven API base URL.
- **Delete every fabrication** in `D` §D.5: confidence-90 defaults, synthetic `src-N` ids,
  invented fallback contracts, client-side stage/progress synthesis, 10-dataset "totals". Absent
  values render as "—".
- **Delete business logic** per `D` §D.6: `lib/export.ts`, status-taxonomy mapping (×3),
  aggregation, quality coercion, response-shape hedging.
- Consume the new `/stats`, `/sources`, `/activity`, `/preferences` endpoints; move all
  pagination server-side.
- Rebuild the settings page against real persistence; wire or remove the topbar search, the
  notification bell, and the dead Resume/Stop/Retry buttons; rename "Pause" to "Cancel".
- Replace the "Indian AI startup" example prompts with product-neutral ones spanning genuinely
  different entity types; render the **actual plan DAG** in `plan-preview.tsx` instead of the
  static 7-step list.
- Fix the no-op Tailwind classes (`shadow-xs`, `h-4.5`, `translate-x-5.5`) deliberately.
- Move tokens to httpOnly cookies (or record the accepted risk) and add server-side route
  guarding.

**Exit criteria:** `next build` and lint pass with zero errors. Every screen renders real data
for a completed run. **A grep-based test asserts no fabricated constant remains** (no `90`
confidence default, no `src-` prefix, no hardcoded contract fields, no `mock-data` import).
Three different prompts produce three visibly different dataset schemas in the UI. Dark mode
toggles and persists. Settings save and survive a reload. The design is pixel-identical to
PirateAgentUI (spot-check each screen against the old build).

---

## Phase 15 — Verification stage & hardening

**Goal:** the critique loop, plus the security and quality pass.

- `VERIFY` step: `POST /ai/v1/verify` → `{feedback, terminate, finalResponse, decision}`;
  feedback re-injected into a `REPLAN` job; **hard caps enforced in Java** on iterations,
  replans and total LLM calls; exceptions in the verify path fail the step and are never
  swallowed by a loop `continue`.
- Deterministic `ContentQualityDetector` (min length, failure/required regex, `ShouldRetry`) as
  a cheap pre-LLM gate.
- Security pass: authorization integration tests per resource type, SSRF suite across every
  address class, prompt-injection framing for scraped content, secret-masking verification,
  dependency license audit, `THIRD-PARTY.md` completed, CI grep asserting no file from
  `anakin-master` or `TheAgenticBrowser-main` is present.
- Performance: `EXPLAIN` on every hot query, job-table archiving, connection-pool sizing.
- Full QA against every functional requirement in `PRD.md` §5.

**Exit criteria:** a `VERIFY` failure triggers a bounded replan and terminates cleanly at the
cap; no run can loop unboundedly (assert by test). The security suite passes. Every PRD FR is
demonstrably met or explicitly recorded as unmet in `Memory.md`.

---

## Phase 16 — Release

- `deploy/docker-compose.yml` verified end-to-end (build, migrate, healthcheck-gated startup).
- README: architecture diagram, setup, run, test, env vars, the single-node constraint, and an
  honest statement of what was and was not verified live.
- Tag the release; record final state in `Memory.md`.

**Exit criteria:** a clean checkout reaches a working system with documented commands, and the
full user journey — prompt → parse → plan → live monitoring → dataset → filter → inspect
evidence → export — works end to end.

---

## Suggested effort ordering

Phases 1-3 are prerequisites for everything. Phases 4-5 are the heart of the product's
differentiation and should not be rushed. Phase 6 is the hardest engineering (no-Redis
durability) and the one most likely to reveal design mistakes, which is why it runs against stubs
before real collection exists. Phases 7-13 are largely independent of each other once 6 is solid.
Phase 14 is large but low-risk because the design is copied, not created.

**Total: 17 phases (0-16).** Phase 0 is complete.

---

## STOP

Phase 0 ends here. No application code has been written. Awaiting your decisions on **G1**
(demo strategy) and confirmation to proceed to **Phase 1**.
