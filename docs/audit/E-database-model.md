# E. Database Model

Engine: **MySQL 8.4 baseline** (local dev runs the installed 9.6). Charset `utf8mb4`,
collation `utf8mb4_0900_ai_ci`. Migrations: **Flyway**, versioned SQL in
`backend/src/main/resources/db/migration/`. ORM: Spring Data JPA / Hibernate 6.

Translated from `backend/prisma/schema.prisma` (16 models, 17 enums). The Prisma model is a good
design and is preserved deliberately — including its **compound tenant-scoped foreign keys**,
which are the strongest idea in it. Three tables are new (`workflow_jobs`, `refresh_tokens`,
`source_domain_policy`) because Redis is gone and because per-domain governance needs config.

---

## E.1 Design principles

1. **MySQL is the only source of truth.** No Redis, so every piece of job state, rate-limit
   decision that must survive restart, activity event and revocation record lives here.
2. **Workspace tenancy on every child table.** Every tenant-owned row carries `workspace_id`,
   and relationships use **compound unique keys** `(workspace_id, id)` so a foreign key can
   reference both columns. A cross-workspace link becomes unrepresentable, not merely unchecked.
3. **UUID `CHAR(36)`**, application-generated. Matches the existing model, keeps compound FKs
   readable, and avoids auto-increment leakage across tenants.
4. **Dynamic datasets without a fixed schema.** Registered typed columns in `dataset_columns` +
   JSON `values` in `dataset_rows`. Different entity types (startups, jobs, sponsors, channels)
   never share a forced schema.
5. **Statuses are `ENUM`, and transitions are enforced in the service layer.** Anakin stores
   status as a bare `VARCHAR(20)` with no guard anywhere (`models/types.go:11-16`,
   `store/postgres.go:29-31,106-128`) — we do the opposite: ENUM in DDL **plus** an explicit
   transition table **plus** `WHERE status = <expected>` on every UPDATE, so an illegal
   transition fails rather than silently corrupting state.
6. **Nothing is silently dropped.** The old `persistDataset` did `continue` on records lacking
   verified sources (`workflow-execution.repository.ts:271-272`), so datasets landed `PARTIAL`
   with unexplained row loss. Here, every rejection becomes a `validation_issues` row and a
   counter.
7. **No fabricated values.** No column has a "pretty default" that invents data. `confidence`
   is nullable; the API returns null as null (the old stack defaulted it to 90 in two places).

---

## E.2 Table inventory (21 tables)

### Identity & tenancy

**`users`**
| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | UUID |
| `email` | VARCHAR(254) UNIQUE NOT NULL | |
| `password_hash` | VARCHAR(100) NULL | nullable so future SSO is possible |
| `name` | VARCHAR(160) NULL | |
| `status` | ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE' | |
| `created_at`, `updated_at` | DATETIME(6) | |

**`workspaces`** — `id` PK, `name` VARCHAR(160), `slug` VARCHAR(80) UNIQUE, `created_by_id`
CHAR(36) → `users(id)` ON DELETE RESTRICT, `status` ENUM('ACTIVE','SUSPENDED'), timestamps.

**`workspace_members`** — composite PK `(workspace_id, user_id)`, `role`
ENUM('OWNER','ADMIN','MEMBER'), `status` ENUM('ACTIVE','REMOVED'), `created_at`. Both FKs
CASCADE. Role rank OWNER > ADMIN > MEMBER is enforced in Java, not by column order.

**`refresh_tokens`** *(new — replaces Redis revocation)*
| Column | Type | Notes |
|---|---|---|
| `jti` | CHAR(36) PK | the JWT id |
| `user_id` | CHAR(36) NOT NULL → users | |
| `workspace_id` | CHAR(36) NULL | |
| `issued_at` | DATETIME(6) NOT NULL | |
| `expires_at` | DATETIME(6) NOT NULL | indexed — drives the purge job |
| `revoked_at` | DATETIME(6) NULL | |
| `replaced_by_jti` | CHAR(36) NULL | rotation chain |
| `reuse_detected_at` | DATETIME(6) NULL | **new**: set when a revoked jti is presented again |

Rationale: the old `TokenService` kept revocation in an in-memory Set with optional Redis, and
**silently swallowed Redis failures** (`token.service.ts:133-139,145-155`), so logout could
degrade without signal. A table makes revocation durable and makes rotation-replay detectable
(the old system rotated and revoked but never detected reuse).

**`user_preferences`** *(in the brief's list; the old project had no table for it, which is why
`settings/page.tsx` saves nothing)*
`user_id` PK → users, `workspace_id` NULL, `theme` ENUM('LIGHT','DARK','SYSTEM') DEFAULT
'SYSTEM', `default_source_cap` SMALLINT UNSIGNED NULL, `auto_dedupe` BOOLEAN NULL,
`default_export_format` ENUM('CSV','JSON','XLSX') NULL, `preferences` JSON NULL (extensible),
`updated_at`. **No hardcoded defaults in the UI** — these come from here.

### Workflow definition

**`workflows`** — `id` PK, `workspace_id` NOT NULL, `created_by_id` NOT NULL, `name`
VARCHAR(200), `requirement_text` TEXT (the original prompt, verbatim), `status`
ENUM('DRAFT','ACTIVE','PAUSED','ARCHIVED'), `planning_status`
ENUM('NOT_STARTED','PLANNING','PLANNED','FAILED'), `planning_error_code` VARCHAR(80),
`planning_error_message` VARCHAR(1000), timestamps. UNIQUE `(workspace_id, id)`.

> Keep `planning_status` and the sanitized error fields. The old project added them in migration
> `20260927161607` precisely so planning failures would be durable and inspectable — that is the
> opposite of a fake success state, and it is required by the brief's error-handling rules.

**`workflow_plans`** — versioned and **immutable** once written.
`id` PK, `workspace_id`, `workflow_id`, `version` INT UNSIGNED, UNIQUE `(workflow_id, version)`.
JSON columns: `objective` TEXT, `requirement` JSON (the full structured requirement),
`constraints` JSON, `source_policy` JSON, `search_strategy` JSON, `extraction_schema` JSON,
`steps` JSON (the DAG), `transformations` JSON, `validation_rules` JSON, `deduplication_rules`
JSON, `output_configuration` JSON, `completion_criteria` JSON. Plus `plan_hash` CHAR(64)
(SHA-256 of the canonical plan, for change detection), `created_by_id`, `created_at`.

> **Safety literals are NOT stored as LLM output.** `respectRobotsTxt`, `respectSiteTerms`,
> `allowAuthentication=false`, `allowCaptchaBypass=false` are hardcoded constants in
> `WorkflowPlanValidator.java`. The old schema had them as Zod literals
> (`workflow-plan.schema.ts:61-64`), which is right; a model must never be able to relax them.

### Execution (the no-Redis core)

**`workflow_runs`** — `id` PK, `workspace_id`, `workflow_id`, `plan_id`, `status`
ENUM('PENDING','PLANNING','RUNNING','COMPLETED','PARTIAL','FAILED','CANCELLED'), `attempt`
SMALLINT UNSIGNED DEFAULT 1, `progress` TINYINT UNSIGNED (0-100, **real**, computed from step
state), counters `records_raw` / `records_found` / `records_valid` / `duplicate_count` /
`sources_processed` / `sources_failed` INT UNSIGNED, `error_code` VARCHAR(80), `error_message`
VARCHAR(1000), `cancel_requested_at` DATETIME(6) NULL, `started_at`, `finished_at`,
`created_at`, `updated_at`. Index `(workspace_id, status, created_at)`.

> `PARTIAL` is a first-class outcome: a run where some sources were blocked or skipped but valid
> records were produced. The design system already has a "Completed with warnings" state
> (`Design.md:109`) — this is what feeds it.

**`workflow_jobs`** *(new — the MySQL queue that replaces BullMQ)*
| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | |
| `workspace_id` | CHAR(36) NOT NULL | |
| `run_id` | CHAR(36) NOT NULL → workflow_runs | |
| `parent_job_id` | CHAR(36) NULL → workflow_jobs(id) | batch/fan-out parent (anakin's `parent_job_id` pattern) |
| `job_type` | ENUM('WORKFLOW_RUN','WORKFLOW_STEP','SOURCE_COLLECT','EXPORT','REPLAN') NOT NULL | |
| `step_id` | CHAR(36) NULL | for `WORKFLOW_STEP` jobs |
| `payload` | JSON NOT NULL | everything needed to execute; a job must be self-contained |
| `status` | ENUM('PENDING','RUNNING','COMPLETED','FAILED','SKIPPED','BLOCKED','CANCELLED') NOT NULL DEFAULT 'PENDING' | the brief's 7 states |
| `priority` | SMALLINT NOT NULL DEFAULT 100 | lower = sooner |
| `attempt_count` | SMALLINT UNSIGNED NOT NULL DEFAULT 0 | **anakin lacks this** (loop variable only) |
| `max_attempts` | SMALLINT UNSIGNED NOT NULL DEFAULT 3 | |
| `next_retry_at` | DATETIME(6) NULL | **anakin lacks this**; drives backoff |
| `locked_at` | DATETIME(6) NULL | lease start |
| `lease_expires_at` | DATETIME(6) NULL | **stale recovery** — anakin has none |
| `worker_id` | VARCHAR(80) NULL | which node/thread holds the lease |
| `version` | INT UNSIGNED NOT NULL DEFAULT 0 | optimistic lock |
| `last_error_code` | VARCHAR(80) NULL | |
| `last_error_message` | VARCHAR(2000) NULL | |
| `result_summary` | JSON NULL | small summary only — never full payloads |
| `scheduled_for` | DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) | delayed/retry scheduling |
| `started_at`, `finished_at`, `created_at`, `updated_at` | DATETIME(6) | |

Indexes (these are what make the claim query fast — get them right or the queue will scan):
```sql
CREATE INDEX idx_jobs_claim     ON workflow_jobs (status, scheduled_for, priority, created_at);
CREATE INDEX idx_jobs_lease     ON workflow_jobs (status, lease_expires_at);
CREATE INDEX idx_jobs_run       ON workflow_jobs (workspace_id, run_id, status);
CREATE INDEX idx_jobs_parent    ON workflow_jobs (parent_job_id, status);
```

**`workflow_steps`** — `id` PK, `workspace_id`, `run_id`, `plan_version`, `sequence` INT
UNIQUE `(run_id, sequence)`, `step_key` VARCHAR(80) (the plan's step id, for dependency
resolution), `depends_on` JSON (array of `step_key`), `type`
ENUM('PLAN','SEARCH','SCRAPE','INTERACT','EXTRACT','TRANSFORM','VALIDATE','DEDUPLICATE','MERGE',
'VERIFY','SAVE','EXPORT'), `status` ENUM('PENDING','RUNNING','COMPLETED','FAILED','SKIPPED',
'BLOCKED','CANCELLED'), `attempt`, `retry_count`, `input` JSON, `output_summary` JSON,
`source_ids` JSON, `duration_ms` INT UNSIGNED NULL, `error_code`, `error_message`,
`started_at`, `finished_at`, `created_at`, `updated_at`.

> Adds `VERIFY` to the old 10-type vocabulary — that is the critique/verification stage adopted
> as a concept from TheAgenticBrowser (independently implemented). `EXPORT` becomes a real step;
> the old runner always skipped it with `EXPORT_NOT_IN_PHASE` (`workflow-runner.ts:167-169`).

**`activity_events`** — `id` BIGINT UNSIGNED AUTO_INCREMENT PK (monotonic, so SSE
`Last-Event-ID` replay works), `workspace_id`, `run_id` NULL, `actor_id` NULL, `action`
VARCHAR(120), `entity_type` VARCHAR(80), `entity_id` VARCHAR(64), `message` VARCHAR(1000) NULL
(**new** — the frontend currently synthesizes human-readable text client-side at
`activity/page.tsx:86-111`), `details` JSON, `created_at` DATETIME(6).
Indexes: `(workspace_id, created_at)`, `(run_id, id)`.

> Written **before** broadcast, always. This is the old project's best monitoring decision
> (`event-broadcaster.ts:56-99`) and it is what makes SSE replay correct without Redis pub/sub.

### Data & provenance

**`datasets`** — `id` PK, `workspace_id`, `workflow_run_id` UNIQUE (1:1), `name` VARCHAR(200),
`description` TEXT NULL, `status` ENUM('BUILDING','READY','PARTIAL','FAILED','ARCHIVED'),
`record_count`, `valid_count`, `duplicate_count`, `source_count` INT UNSIGNED, `created_at`,
`updated_at`. UNIQUE `(workspace_id, id)`.

**`dataset_columns`** — `id` PK, `workspace_id`, `dataset_id`, `column_key` VARCHAR(128),
`label` VARCHAR(160), `type` ENUM('STRING','NUMBER','BOOLEAN','DATE','DATETIME','URL','EMAIL',
'CURRENCY','PHONE','JSON'), `position` INT UNIQUE `(dataset_id, position)`, `required` BOOLEAN,
`filterable` BOOLEAN, `sortable` BOOLEAN, `config` JSON NULL. This registry is what makes
dynamic filtering safe: **every filter/sort key is validated against it before touching SQL**,
which is how the old project prevented JSON-path injection (`Memory.md:59`).

**`dataset_rows`**
| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | |
| `workspace_id`, `dataset_id` | CHAR(36) | compound FK to `datasets(workspace_id,id)` |
| `values` | JSON NOT NULL | normalized values |
| `raw_values` | JSON NULL | pre-normalization, for audit |
| `quality_metadata` | JSON NULL | per-field confidence, conflict notes |
| `search_text` | TEXT NULL | **new**: application-maintained flattened text of `values` |
| `confidence` | DECIMAL(5,4) NULL | 0-1. **Nullable — no default 90** |
| `verification_status` | ENUM('SOURCE_CITED_UNVERIFIED','UNSUPPORTED','CONFLICTED') NULL | |
| `is_valid` | BOOLEAN NOT NULL DEFAULT FALSE | |
| `duplicate_of_id` | CHAR(36) NULL → dataset_rows(id) ON DELETE RESTRICT | duplicates are **linked, never deleted** |
| `collected_at` | DATETIME(6) NULL | nullable — no `now` fallback |
| `created_at` | DATETIME(6) | |

```sql
CREATE FULLTEXT INDEX ft_rows_search ON dataset_rows (search_text);
CREATE INDEX idx_rows_dataset ON dataset_rows (workspace_id, dataset_id, is_valid, confidence);
CREATE INDEX idx_rows_dup     ON dataset_rows (duplicate_of_id);
```
> MySQL cannot FULLTEXT-index a JSON column, so `search_text` is maintained by the application
> on insert/update. This replaces the old `LIKE '%…%'` over raw JSON
> (`dataset-query.repository.ts:732-741`), which had no index and could not scale.
> **Confidence is one unit everywhere: 0-1 as `DECIMAL(5,4)`.** The old stack stored 0-1,
> returned 0-100 with a default of 90 from the route, and wrote raw values on export. Formatting
> is a presentation concern and belongs in the UI.

**`sources`** — `id` PK, `workspace_id`, `run_id`, `url` TEXT, `canonical_url` TEXT,
`canonical_url_hash` CHAR(64), UNIQUE `(run_id, canonical_url_hash)` (dedupe per run), `domain`
VARCHAR(255), `title` VARCHAR(500) NULL, `snippet` TEXT NULL, `status`
ENUM('DISCOVERED','ALLOWED','QUEUED','PROCESSING','COLLECTED','BLOCKED','SKIPPED','FAILED'),
`source_type` VARCHAR(40) NULL, `policy_reason` VARCHAR(200) NULL, `robots_status`
ENUM('ALLOWED','DISALLOWED','UNAVAILABLE','NOT_CHECKED') NULL, `robots_checked_at` DATETIME(6),
`relevance_score` DECIMAL(6,5) NULL (**new** — persists the ranking score so selection is
auditable), `attempt_count` SMALLINT UNSIGNED DEFAULT 0, `last_attempt_at` DATETIME(6),
`retrieved_at` DATETIME(6) NULL, `content_hash` CHAR(64) NULL, `verified_by_tool` BOOLEAN
NOT NULL DEFAULT FALSE (**new** — was a runtime-only flag in `AgentResultNormalizer.ts:169`;
persisting it is what makes the anti-fabrication rule auditable after the fact),
`error_code`, `error_message`, `source_metadata` JSON, timestamps.
Indexes: `(workspace_id, status)`, `(run_id, domain)`.

> The legacy `FETCHED` status is dropped — the old schema carried both `FETCHED` and `COLLECTED`
> for compatibility (`Memory.md:95`). A new build should have one word for one thing.
> **Full page bodies are never stored** (old decision, `Memory.md:103`) — only snippets.

**`source_evidence`** — `id` PK, `workspace_id`, `dataset_id`, `row_id`, `source_id`,
`field_key` VARCHAR(128) NULL (null = whole-row evidence), `evidence_type` VARCHAR(40) DEFAULT
'EXTRACTED', `snippet` VARCHAR(2000), `value_hash` CHAR(64) NULL, `is_verified` BOOLEAN NOT
NULL DEFAULT FALSE (**new** — persists the `isSnippetVerifyingValue` verdict from
`provenance.service.ts:12-48` instead of recomputing it on every read), `confidence`
DECIMAL(5,4), `retrieved_at`, `created_at`. Index `(row_id, field_key)`.

> **Invariant: a row with zero evidence links is a data-integrity bug.** Enforced in
> `DatasetPersistenceService` inside the same transaction as the row insert (the old
> `insertRowWithEvidence` rule, `Memory.md:43`) — but rejections are recorded, not skipped
> silently.
> Field-level attribution is only claimed where it is actually known. The old project correctly
> refused to invent per-field citations because the agent supplies record-level URLs
> (`Memory.md:55`); keep that honesty, and populate `field_key` only when extraction really
> returns per-field provenance.

**`validation_issues`** — `id` PK, `workspace_id`, `dataset_id`, `row_id`, `field_key` NULL,
`rule_code` VARCHAR(100), `severity` ENUM('INFO','WARNING','ERROR'), `message` VARCHAR(1000),
`expected` JSON, `actual` JSON, `created_at`. Index `(dataset_id, severity)`.

> This table is also where **rejected rows are recorded**, fixing the silent-drop defect.

**`deduplication_events`** — `id` PK, `workspace_id`, `run_id`, `dataset_id`,
`canonical_row_id`, `duplicate_row_id`, `decision` ENUM('LINKED','MERGED','KEPT_SEPARATE',
'REVIEW_REQUIRED'), `confidence` DECIMAL(5,4), `matched_fields` JSON, `reason` VARCHAR(1000),
`created_at`. UNIQUE `(run_id, duplicate_row_id)`.

**`data_quality_reports`** — `id` PK, `workspace_id`, `run_id` UNIQUE, `dataset_id` UNIQUE,
`raw_count`, `normalized_count`, `valid_count`, `invalid_count`, `duplicate_count`,
`review_required_count`, `conflict_count`, `source_backed_count` INT UNSIGNED, `quality_score`
DECIMAL(5,4), `mean_confidence` DECIMAL(5,4), `metrics` JSON, `created_at`.

> `quality_score` and `mean_confidence` come from a **documented heuristic formula**
> (`DataQualityService.ts:77-79`). Label them as such in the API and UI. Presenting a formula
> output as "confidence" overstates what was measured — and this is exactly the kind of claim
> that does not survive a viva question.

### Governance & export

**`source_domain_policy`** *(new; per-domain config, modeled on the information in anakin's
`domain_configs` but independently authored)*
`id` PK, `workspace_id` NULL (**NULL = platform-wide default**), `domain` VARCHAR(255),
`decision` ENUM('ALLOW','BLOCK','REQUIRE_REVIEW') NOT NULL DEFAULT 'ALLOW',
`max_requests_per_minute` SMALLINT UNSIGNED NULL, `request_timeout_ms` INT UNSIGNED NULL,
`max_attempts` SMALLINT UNSIGNED NULL, `min_content_length` INT UNSIGNED NULL,
`failure_patterns` JSON NULL (regex array), `required_patterns` JSON NULL, `custom_user_agent`
VARCHAR(255) NULL, `blocked_reason` VARCHAR(500) NULL, `notes` VARCHAR(1000) NULL,
`updated_at`. UNIQUE `(workspace_id, domain)`.

> Resolution order: exact host → parent domain → platform default (anakin's `cache.go:74-80`
> pattern). Cached in memory with a 60s refresh. `blocked_domains` from a plan always wins over
> an ALLOW here.

**`export_jobs`** — `id` PK, `workspace_id`, `dataset_id`, `requested_by_id`, `format`
ENUM('CSV','JSON','XLSX'), `status` ENUM('PENDING','RUNNING','COMPLETED','FAILED','EXPIRED'),
`filters` JSON, `sort` JSON, `columns` JSON NULL (selected subset), `file_key` VARCHAR(1024),
`file_metadata` JSON (fileName, fileSize, rowCount, columnCount, contentType, checksumSha256),
`error_code`, `error_message`, `expires_at` DATETIME(6) NULL, `created_at`, `started_at`,
`finished_at`. Index `(status, created_at)` for the sweeper.

> Two fixes over the old design: exports become **real queued jobs** (the old version used
> in-process promises at `export.service.ts:41-53`, so a restart stranded jobs in `RUNNING`
> forever), and `expires_at`/`EXPIRED` are **actually enforced** by a scheduled sweeper (the old
> schema had both and used neither).

---

## E.3 Key DDL — the queue table

```sql
CREATE TABLE workflow_jobs (
  id                  CHAR(36)      NOT NULL,
  workspace_id        CHAR(36)      NOT NULL,
  run_id              CHAR(36)      NOT NULL,
  parent_job_id       CHAR(36)      NULL,
  job_type            ENUM('WORKFLOW_RUN','WORKFLOW_STEP','SOURCE_COLLECT','EXPORT','REPLAN') NOT NULL,
  step_id             CHAR(36)      NULL,
  payload             JSON          NOT NULL,
  status              ENUM('PENDING','RUNNING','COMPLETED','FAILED','SKIPPED','BLOCKED','CANCELLED')
                                    NOT NULL DEFAULT 'PENDING',
  priority            SMALLINT      NOT NULL DEFAULT 100,
  attempt_count       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts        SMALLINT UNSIGNED NOT NULL DEFAULT 3,
  next_retry_at       DATETIME(6)   NULL,
  locked_at           DATETIME(6)   NULL,
  lease_expires_at    DATETIME(6)   NULL,
  worker_id           VARCHAR(80)   NULL,
  version             INT UNSIGNED  NOT NULL DEFAULT 0,
  last_error_code     VARCHAR(80)   NULL,
  last_error_message  VARCHAR(2000) NULL,
  result_summary      JSON          NULL,
  scheduled_for       DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  started_at          DATETIME(6)   NULL,
  finished_at         DATETIME(6)   NULL,
  created_at          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT fk_jobs_run    FOREIGN KEY (run_id, workspace_id)
                            REFERENCES workflow_runs (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT fk_jobs_parent FOREIGN KEY (parent_job_id)
                            REFERENCES workflow_jobs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```
Note the compound FK `(run_id, workspace_id)` → `workflow_runs(id, workspace_id)`: a job can
never point at a run in another workspace. Claim/lease SQL is in
`J-no-redis-job-architecture.md`.

---

## E.4 Enums carried forward (17 → 18)

Preserved from Prisma: `UserStatus`, `WorkspaceStatus`, `WorkspaceRole`, `MembershipStatus`,
`WorkflowStatus`, `WorkflowPlanningStatus`, `WorkflowRunStatus`, `WorkflowStepType` (+`VERIFY`),
`WorkflowStepStatus`, `DatasetStatus`, `DatasetColumnType` (+`PHONE`),
`RecordVerificationStatus`, `SourceStatus` (−`FETCHED`), `ValidationSeverity`,
`DeduplicationDecision`, `ExportFormat`, `ExportJobStatus`.
New: `JobStatus` (the brief's 7 states), `JobType`, `RobotsStatus`, `DomainDecision`.

`WorkflowStepStatus` and `JobStatus` share the brief's vocabulary exactly:
`PENDING, RUNNING, COMPLETED, FAILED, SKIPPED, BLOCKED, CANCELLED`.

---

## E.5 Migration plan

| File | Contents |
|---|---|
| `V1__baseline_identity.sql` | `users`, `workspaces`, `workspace_members`, `refresh_tokens`, `user_preferences` |
| `V2__workflow_definition.sql` | `workflows`, `workflow_plans` |
| `V3__execution.sql` | `workflow_runs`, `workflow_steps`, `workflow_jobs`, `activity_events` |
| `V4__governance.sql` | `source_domain_policy`, `sources` |
| `V5__datasets.sql` | `datasets`, `dataset_columns`, `dataset_rows`, `source_evidence`, `validation_issues`, `deduplication_events`, `data_quality_reports` |
| `V6__export.sql` | `export_jobs` |
| `V7__seed_dev.sql` | dev user + workspace only, **guarded to non-production** |

Split by aggregate rather than one giant file, so a phase can be rolled forward independently.
`V7` must refuse to run when `APP_ENV=production`, preserving the old seed's guard
(`prisma/seed.ts:3`) — and must **not** create a demo login.

---

## E.6 What is intentionally absent

| Absent | Reason |
|---|---|
| Any Redis-backed structure (queue, rate-limit keys, pub/sub channels, revocation set) | Excluded. All four replaced per `J` |
| Raw page bodies | Old decision, kept (`Memory.md:103`). Snippets + hashes only |
| A fixed table per entity type | Dynamic datasets are a core requirement |
| Default values that invent data (`confidence=90`, `collected_at=now`, `sourceIds=src-N`) | Fabrication; absent means absent |
| `demo_*` tables or seeded demo datasets | The demo layer is dropped entirely |
| Postgres-only syntax (`UUID`, `gen_random_uuid()`, `TIMESTAMPTZ`, `COUNT(*) FILTER`) | anakin's DDL is Postgres; ours is MySQL |

Next: `F-workflow-model.md`.
