-- Phase 11: exports and the operations surface.
--
-- Numbering: the audit reserved V3/V4 for identity, and Phase 9 already took V3 for the dataset
-- platform because code existed and a slot did not. Authentication is the next phase, so it arrives
-- as V5. No applied migration is renumbered or edited — Flyway verifies checksums of what it has run.
--
-- An export is a job, not a request. The old project built a file inside the HTTP request that asked
-- for it and kept the job's state in an in-process promise, so a restart left every running export
-- stranded in RUNNING forever (`export.service.ts:41-53`, `00-FORENSIC-AUDIT.md` §5). Here the work
-- is a row in `workflow_jobs` with `job_type = 'EXPORT'`, claimed by the same MySQL-backed worker
-- pool as a step, under the same lease, heartbeat, retry and reclaim rules. No Redis, no second
-- queue, and nothing that only the node which started it knows about.
--
-- Progress is measured, not synthesised. `written_rows` advances by the count of rows actually
-- handed to the writer, `progress_percent` is derived from it against `total_rows`, and
-- `total_rows` is a COUNT(*) taken before the first byte is written. A job that is 40% done has
-- written 40% of the rows, and a job cannot reach 100 until `written_rows = total_rows` — the
-- previous project's `RUNNING → 50` is the specific thing this column must not repeat.

CREATE TABLE export_jobs (
  id               CHAR(36)      NOT NULL,
  workspace_id     CHAR(36)      NOT NULL,
  dataset_id       CHAR(36)      NOT NULL,
  -- The job row that executes this export. Kept beside the record rather than derived by a join so a
  -- reader of one row can find its lease, its attempt count and its worker without knowing the
  -- queue's schema.
  job_id           CHAR(36)      NULL,
  run_id           CHAR(36)      NULL,
  requested_by_id  CHAR(36)      NOT NULL,
  format           ENUM('CSV','JSON','XLSX') NOT NULL,
  -- The listing's filter, sort and validity scope, stored so a re-run of a job reclaimed after a
  -- crash writes the same file the requester asked for rather than whatever the query means now.
  scope            JSON          NOT NULL,
  status           ENUM('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')
                                  NOT NULL DEFAULT 'QUEUED',
  -- COUNT(*) taken before writing. Zero is a real answer: an empty dataset exports as a file with a
  -- header row and nothing else, and says so, rather than being reported as a failure.
  total_rows       INT UNSIGNED  NOT NULL DEFAULT 0,
  written_rows     INT UNSIGNED  NOT NULL DEFAULT 0,
  progress_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
  file_name        VARCHAR(255)  NULL,
  file_path        VARCHAR(500)  NULL,
  file_bytes       BIGINT UNSIGNED NULL,
  -- SHA-256 of the finished file, so a download can be checked against what was written rather than
  -- against what the writer said it wrote.
  checksum         CHAR(64)      NULL,
  error_code       VARCHAR(80)   NULL,
  error_message    VARCHAR(1000) NULL,
  created_at       DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  started_at       DATETIME(6)   NULL,
  finished_at      DATETIME(6)   NULL,
  updated_at       DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                 ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_export_scope (workspace_id, id),
  KEY idx_exports_dataset (workspace_id, dataset_id, created_at),
  KEY idx_exports_status (status, created_at),
  -- A dataset deleted with its exports still on disk would leave rows pointing at nothing, so the
  -- record goes with it; the file itself is swept by the same rule the retention path uses.
  CONSTRAINT fk_export_dataset FOREIGN KEY (dataset_id, workspace_id)
      REFERENCES datasets (id, workspace_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The activity feed is read newest-first across a workspace, and cursor-paged for the streaming
-- phase that has not been built. Neither exists today: `idx_events_run` serves a single run, and a
-- workspace-wide listing sorted the whole table.
CREATE INDEX idx_events_workspace_recent ON activity_events (workspace_id, id DESC);

-- Run history per workflow is the listing a dashboard opens with. `idx_workflows_workspace` orders
-- workflows; runs were only ever reachable one at a time.
--
-- `created_at`, not `id`: run ids are random UUIDs, so an index keyed on id would serve a listing
-- that looks sorted to the database and arrives in no order a human can read. Workflows and events
-- can page by id because their ids increase; runs cannot.
CREATE INDEX idx_runs_workflow_recent ON workflow_runs (workspace_id, workflow_id, created_at DESC);
