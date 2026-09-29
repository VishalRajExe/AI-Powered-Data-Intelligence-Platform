-- Phase 7: execution — the no-Redis core. Queue semantics in docs/audit/J-no-redis-job-architecture.md.

CREATE TABLE workflow_runs (
  id               CHAR(36)     NOT NULL,
  workspace_id     CHAR(36)     NOT NULL,
  workflow_id      CHAR(36)     NOT NULL,
  plan_id          CHAR(36)     NOT NULL,
  status           ENUM('PENDING','PLANNING','RUNNING','COMPLETED','PARTIAL','FAILED','CANCELLED')
                                NOT NULL DEFAULT 'PENDING',
  attempt          SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  -- Derived from real step state on every write; never the old `COMPLETED→100, RUNNING→50,
  -- else 0` synthesis the previous project reported to the UI.
  progress         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  records_raw      INT UNSIGNED NOT NULL DEFAULT 0,
  records_found    INT UNSIGNED NOT NULL DEFAULT 0,
  records_valid    INT UNSIGNED NOT NULL DEFAULT 0,
  duplicate_count  INT UNSIGNED NOT NULL DEFAULT 0,
  sources_processed INT UNSIGNED NOT NULL DEFAULT 0,
  sources_failed   INT UNSIGNED NOT NULL DEFAULT 0,
  error_code       VARCHAR(80)    NULL,
  error_message    VARCHAR(1000)  NULL,
  cancel_requested_at DATETIME(6) NULL,
  started_at       DATETIME(6)    NULL,
  finished_at      DATETIME(6)    NULL,
  created_at       DATETIME(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at       DATETIME(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                  ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  -- The compound key the job table's foreign key targets, so a job can never point at a run in
  -- another workspace, and `UNIQUE (workflow_id, attempt)` makes "start a run twice" a insert
  -- failure rather than two competing executions of the same plan.
  UNIQUE KEY uq_run_scope (id, workspace_id),
  UNIQUE KEY uq_run_attempt (workflow_id, attempt),
  KEY idx_runs_workspace (workspace_id, status, created_at),
  CONSTRAINT fk_runs_workflow FOREIGN KEY (workflow_id) REFERENCES workflows (id) ON DELETE CASCADE,
  -- Also cascade: deleting a workflow removes its plans, and a run whose plan row is gone is a run
  -- whose recorded steps cannot be reconciled with anything. Without this the parent delete is
  -- refused outright, so a workflow that has ever run can never be deleted (found by running the
  -- schema against MySQL rather than reading it).
  CONSTRAINT fk_runs_plan     FOREIGN KEY (plan_id)     REFERENCES workflow_plans (id)
                                                        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE workflow_steps (
  id              CHAR(36)     NOT NULL,
  workspace_id    CHAR(36)     NOT NULL,
  run_id          CHAR(36)     NOT NULL,
  plan_version    INT UNSIGNED NOT NULL,
  -- The plan's own step id. UNIQUE (run_id, step_key) is what makes enqueue idempotent: a
  -- re-planned or replayed scheduling pass cannot create a second step for the same node.
  step_key        VARCHAR(80)  NOT NULL,
  sequence        INT          NOT NULL,
  depends_on      JSON         NULL,
  type            ENUM('PLAN','SEARCH','SCRAPE','INTERACT','EXTRACT','TRANSFORM','VALIDATE',
                       'DEDUPLICATE','MERGE','VERIFY','SAVE','EXPORT') NOT NULL,
  status          ENUM('PENDING','RUNNING','COMPLETED','FAILED','SKIPPED','BLOCKED','CANCELLED')
                               NOT NULL DEFAULT 'PENDING',
  attempt         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  retry_count     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  input           JSON         NULL,
  output_summary  JSON         NULL,
  source_ids      JSON         NULL,
  duration_ms     INT UNSIGNED NULL,
  error_code      VARCHAR(80)  NULL,
  error_message   VARCHAR(1000) NULL,
  started_at      DATETIME(6)  NULL,
  finished_at     DATETIME(6)  NULL,
  created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                               ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_step_key (run_id, step_key),
  UNIQUE KEY uq_step_sequence (run_id, sequence),
  KEY idx_steps_run (workspace_id, run_id, status),
  CONSTRAINT fk_steps_run FOREIGN KEY (run_id, workspace_id)
      REFERENCES workflow_runs (id, workspace_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The queue that replaces BullMQ. `J` §J.1: the four columns that make this a queue rather than
-- a status table are scheduled_for, lease_expires_at, worker_id and version.
CREATE TABLE workflow_jobs (
  id                  CHAR(36)      NOT NULL,
  workspace_id        CHAR(36)      NOT NULL,
  run_id              CHAR(36)      NOT NULL,
  parent_job_id       CHAR(36)      NULL,
  job_type            ENUM('WORKFLOW_RUN','WORKFLOW_STEP','SOURCE_COLLECT','EXPORT','REPLAN') NOT NULL,
  step_id             CHAR(36)      NULL,
  -- Everything needed to execute: a job must be self-contained, because a worker that has to
  -- re-read mutable plan state to decide what to do is a worker that can act on the wrong plan.
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
  updated_at          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                    ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  -- Duplicate-job prevention, the structural kind: one step job per step. NULL step_id (run
  -- jobs, future fan-out parents) is unconstrained here, as MySQL allows.
  UNIQUE KEY uq_job_per_step (run_id, step_id),
  KEY idx_jobs_claim  (status, scheduled_for, priority, created_at),
  KEY idx_jobs_lease  (status, lease_expires_at),
  KEY idx_jobs_run    (workspace_id, run_id, status),
  KEY idx_jobs_parent (parent_job_id, status),
  CONSTRAINT fk_jobs_run FOREIGN KEY (run_id, workspace_id)
      REFERENCES workflow_runs (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT fk_jobs_parent FOREIGN KEY (parent_job_id)
      REFERENCES workflow_jobs (id) ON DELETE CASCADE,
  CONSTRAINT fk_jobs_step FOREIGN KEY (step_id) REFERENCES workflow_steps (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Durable activity log. Written before any in-process broadcast, always: it is what makes SSE
-- replay and post-restart history correct without Redis pub/sub.
CREATE TABLE activity_events (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id CHAR(36)        NOT NULL,
  run_id       CHAR(36)        NULL,
  actor_id     CHAR(36)        NULL,
  action       VARCHAR(120)    NOT NULL,
  entity_type  VARCHAR(80)     NULL,
  entity_id    VARCHAR(64)     NULL,
  -- Server-authored text. The previous UI synthesised human-readable strings client-side, so
  -- the wording of what happened depended on which page rendered it.
  message      VARCHAR(1000)   NULL,
  details      JSON            NULL,
  created_at   DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_events_workspace (workspace_id, created_at),
  KEY idx_events_run (run_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
