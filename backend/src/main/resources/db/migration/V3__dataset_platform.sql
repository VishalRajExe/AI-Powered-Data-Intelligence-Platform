-- Phase 9: the dataset platform. Numbering note: the audit reserved `V3` for identity, but identity
-- belongs to the authentication phase, which is still unbuilt, and an unapplied migration is not yet
-- reserved in any real sense — Flyway verifies checksums of what has *run*. Datasets come first
-- because they have working code behind them now; authentication arrives as V4.
--
-- The whole point of these tables is that nothing about them is fixed. A dataset's columns are rows
-- in `dataset_columns`, written from the run's own extraction schema and requirement field list, so a
-- run about funded companies and a run about YouTube channels produce different columns from the same
-- schema. There is no `startup_name` column anywhere in this file, and that is the defect class the
-- rebuild was started for (`demo/scenarios.data.ts` hardcoded 52 real plus 50 fabricated startups).
--
-- Values are stored as JSON, and search, filter and sort operate on that JSON through
-- `JSON_EXTRACT(values_json, ?)` with the path bound as a parameter — never concatenated into SQL —
-- with the column key validated against `dataset_columns` first. The trade-off is recorded in
-- Memory.md: a per-column functional index is the upgrade path, and until then a filtered read of a
-- large dataset is a scan of that dataset's rows. The alternative — one generated column per field,
-- created at save time — would mean DDL per dataset, which is not something a shared MySQL should do
-- on behalf of a prompt.
--
-- `workspace_id` carries no foreign key, exactly as in V1 and V2: `workspaces` arrives with the
-- authentication phase. Every dataset read is scoped by the server-configured workspace id.

CREATE TABLE datasets (
  id                CHAR(36)         NOT NULL,
  workspace_id      CHAR(36)         NOT NULL,
  -- A run produces one dataset. The unique key is what makes the save step replayable: a job that
  -- is claimed twice, or retried after a partial write, replaces its own dataset rather than
  -- leaving two versions of the same run's answer on different rows.
  run_id            CHAR(36)         NOT NULL,
  workflow_id       CHAR(36)         NOT NULL,
  plan_id           CHAR(36)         NOT NULL,
  step_id           CHAR(36)         NULL,
  objective         TEXT             NOT NULL,
  -- Verbatim user prompt. A dataset that only remembers the model's interpretation of the request
  -- cannot be audited against what was actually asked for.
  requirement_text  TEXT             NULL,
  entity_type       VARCHAR(80)      NULL,
  -- The extraction schema this dataset was produced under, kept with the dataset so a reader can
  -- check a value against the contract that produced it rather than against a summary of it.
  extraction_schema JSON             NOT NULL,
  status            ENUM('BUILDING','READY','EMPTY','FAILED') NOT NULL DEFAULT 'BUILDING',
  row_count             INT UNSIGNED NOT NULL DEFAULT 0,
  valid_row_count         INT UNSIGNED NOT NULL DEFAULT 0,
  invalid_row_count       INT UNSIGNED NOT NULL DEFAULT 0,
  duplicate_count         INT UNSIGNED NOT NULL DEFAULT 0,
  conflict_count          INT UNSIGNED NOT NULL DEFAULT 0,
  source_count            INT UNSIGNED NOT NULL DEFAULT 0,
  verified_source_count   INT UNSIGNED NOT NULL DEFAULT 0,
  unverified_source_count INT UNSIGNED NOT NULL DEFAULT 0,
  blocked_source_count    INT UNSIGNED NOT NULL DEFAULT 0,
  records_without_evidence INT UNSIGNED NOT NULL DEFAULT 0,
  -- Null until something measured it. A zero here would claim a score of nothing, which is a
  -- different statement from no score.
  quality_score     DECIMAL(6,5)     NULL,
  quality_json      JSON             NULL,
  -- The formula behind quality_score travels with it: five measured ratios averaged with equal
  -- weight, not a measurement of truth.
  quality_basis     TEXT             NULL,
  error_code        VARCHAR(80)      NULL,
  error_message     VARCHAR(1000)    NULL,
  created_at        DATETIME(6)      NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at        DATETIME(6)      NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                     ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_dataset_run (run_id),
  -- Column order is `(id, workspace_id)`, not the `(workspace_id, id)` of `workflows`, because a
  -- foreign key can only reference an existing key in that exact order and every child here wants
  -- to say `REFERENCES datasets (id, workspace_id)`. `workflow_runs` made the same choice for the
  -- same reason; `workflows` predates it.
  UNIQUE KEY uq_dataset_scope (id, workspace_id),
  KEY idx_datasets_workspace (workspace_id, status, created_at),
  KEY idx_datasets_workflow (workspace_id, workflow_id, created_at),
  CONSTRAINT fk_dataset_run FOREIGN KEY (run_id, workspace_id)
      REFERENCES workflow_runs (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT fk_dataset_workflow FOREIGN KEY (workspace_id, workflow_id)
      REFERENCES workflows (workspace_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The dynamic schema. One row per field, ordered by `position`, typed by whatever the run's contract
-- said. A column the data contains and the plan never declared is still a column — dropping it would
-- be the silent loss the pipeline exists to prevent — but it is recorded with `origin` so a reader can
-- tell a declared field from an invented one.
CREATE TABLE dataset_columns (
  id            CHAR(36)        NOT NULL,
  dataset_id    CHAR(36)        NOT NULL,
  workspace_id  CHAR(36)        NOT NULL,
  -- The folded key the pipeline normalizes records to, and the JSON path row values are read by.
  field_key     VARCHAR(120)    NOT NULL,
  label         VARCHAR(200)    NULL,
  type          VARCHAR(20)     NOT NULL DEFAULT 'STRING',
  required      TINYINT(1)      NOT NULL DEFAULT 0,
  position      INT UNSIGNED    NOT NULL DEFAULT 0,
  origin        ENUM('PLAN','EXTRACTION_SCHEMA','PIPELINE','DATA') NOT NULL,
  description   VARCHAR(1000)   NULL,
  -- Measured on the saved rows, so a listing can show a thin column without loading them.
  populated_count INT UNSIGNED  NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_column_key (dataset_id, field_key),
  KEY idx_columns_position (dataset_id, position),
  CONSTRAINT fk_column_dataset FOREIGN KEY (dataset_id, workspace_id)
      REFERENCES datasets (id, workspace_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE dataset_rows (
  id              CHAR(36)        NOT NULL,
  dataset_id      CHAR(36)        NOT NULL,
  workspace_id    CHAR(36)        NOT NULL,
  run_id          CHAR(36)        NOT NULL,
  step_id         CHAR(36)        NULL,
  record_index    INT UNSIGNED    NOT NULL,
  values_json     JSON            NOT NULL,
  -- What the source said before normalization, kept so a surprising value can be traced to the rule
  -- that produced it instead of being indistinguishable from the page.
  raw_values_json JSON            NULL,
  search_text     TEXT            NULL,
  -- Java's verdict, from RowContractEnforcer. `advisory_valid` is the pipeline's own and is kept
  -- beside it, never merged into it: the two disagreeing is information.
  valid           TINYINT(1)      NOT NULL,
  advisory_valid  TINYINT(1)      NOT NULL,
  verification_status VARCHAR(30) NOT NULL DEFAULT 'UNSUPPORTED',
  confidence      DECIMAL(6,5)    NULL,
  duplicate_of_row_id CHAR(36)    NULL,
  match_type      VARCHAR(20)     NULL,
  duplicate_key   VARCHAR(200)    NULL,
  review_required TINYINT(1)      NOT NULL DEFAULT 0,
  review_reasons  JSON            NULL,
  issues          JSON            NULL,
  normalization_notes JSON        NULL,
  conflict_count  INT UNSIGNED    NOT NULL DEFAULT 0,
  source_count    INT UNSIGNED    NOT NULL DEFAULT 0,
  verified_source_count INT UNSIGNED NOT NULL DEFAULT 0,
  -- Field-level coverage: how many of this row's populated fields can be traced to a source.
  populated_field_count   INT UNSIGNED NOT NULL DEFAULT 0,
  evidenced_field_count   INT UNSIGNED NOT NULL DEFAULT 0,
  created_at      DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_row_index (dataset_id, record_index),
  KEY idx_rows_dataset_list (dataset_id, valid, record_index),
  KEY idx_rows_duplicate (duplicate_of_row_id),
  CONSTRAINT fk_row_dataset FOREIGN KEY (dataset_id, workspace_id)
      REFERENCES datasets (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT fk_row_canonical FOREIGN KEY (duplicate_of_row_id)
      REFERENCES dataset_rows (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Every URL this run touched, including the ones that produced nothing. A source that was refused
-- before it was fetched is kept with the reason: "the site said no" and "we never asked" have to stay
-- distinguishable, and a caller asking why a field is empty needs the difference.
CREATE TABLE dataset_sources (
  id              CHAR(36)        NOT NULL,
  dataset_id      CHAR(36)        NOT NULL,
  workspace_id    CHAR(36)        NOT NULL,
  run_id          CHAR(36)        NOT NULL,
  step_id         CHAR(36)        NULL,
  url             VARCHAR(1000)   NOT NULL,
  -- SHA-256 of the canonical form, because a URL cannot be a unique key at 1000 characters and a
  -- `?utm_source=` variant must not become a second source for one page.
  url_hash        CHAR(64)        NOT NULL,
  domain          VARCHAR(255)    NULL,
  title           VARCHAR(500)    NULL,
  snippet         TEXT            NULL,
  -- How this page was reached: search, scrape, interact, or combinations in the order they happened.
  source_type     VARCHAR(40)     NOT NULL DEFAULT 'search',
  retrieved_at    DATETIME(6)     NULL,
  -- The anti-fabrication flag. Nothing else in this schema may set it true.
  verified_by_tool TINYINT(1)     NOT NULL DEFAULT 0,
  provenance      ENUM('TOOL_RETURNED','MODEL_CITED','REFUSED_BEFORE_FETCH') NOT NULL,
  blocked_code    VARCHAR(80)     NULL,
  blocked_reason  VARCHAR(1000)   NULL,
  citation_count  INT UNSIGNED    NOT NULL DEFAULT 0,
  cited_by_rows   INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at      DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_source_url (dataset_id, url_hash),
  KEY idx_sources_dataset (dataset_id, verified_by_tool),
  KEY idx_sources_domain (dataset_id, domain),
  CONSTRAINT fk_source_dataset FOREIGN KEY (dataset_id, workspace_id)
      REFERENCES datasets (id, workspace_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The row-to-source join, in both directions: which pages support this row, and which rows rest on
-- this page. `cited_by_record` distinguishes a URL the record itself named from one attached by the
-- collection run, which is the difference between evidence and proximity.
CREATE TABLE dataset_row_sources (
  id              CHAR(36)     NOT NULL,
  dataset_id      CHAR(36)     NOT NULL,
  workspace_id    CHAR(36)     NOT NULL,
  row_id          CHAR(36)     NOT NULL,
  source_id       CHAR(36)     NOT NULL,
  cited_by_record TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_row_source (row_id, source_id),
  KEY idx_row_sources_source (source_id),
  KEY idx_row_sources_dataset (dataset_id),
  CONSTRAINT fk_rs_row FOREIGN KEY (row_id) REFERENCES dataset_rows (id) ON DELETE CASCADE,
  CONSTRAINT fk_rs_source FOREIGN KEY (source_id) REFERENCES dataset_sources (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Field-level traceability, where it exists — and only where it exists. A field is given a source
-- here when the attribution is real: the value *is* the URL of that page (a `source_url` field, or
-- any URL-valued field naming the page it was read from). A row citing three pages does not make
-- three sources the provenance of every field in it, so no such edge is written; the evidence API
-- returns the row-level sources separately and labels them as row-level. That distinction is the
-- difference between traceability and a plausible-looking join.
CREATE TABLE dataset_field_evidence (
  id            CHAR(36)     NOT NULL,
  dataset_id    CHAR(36)     NOT NULL,
  workspace_id  CHAR(36)     NOT NULL,
  row_id        CHAR(36)     NOT NULL,
  column_key    VARCHAR(120) NOT NULL,
  source_id     CHAR(36)     NOT NULL,
  -- FIELD_URL: the value is itself a URL this run retrieved. DECLARED_SOURCE: the contract's own
  -- URL-typed field names this page.
  kind          ENUM('FIELD_URL','DECLARED_SOURCE') NOT NULL,
  field_value   VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_field_evidence (row_id, column_key, source_id, kind),
  KEY idx_field_evidence_dataset (dataset_id, column_key),
  KEY idx_field_evidence_source (source_id),
  CONSTRAINT fk_fe_row FOREIGN KEY (row_id) REFERENCES dataset_rows (id) ON DELETE CASCADE,
  CONSTRAINT fk_fe_source FOREIGN KEY (source_id) REFERENCES dataset_sources (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Disagreements between sources, with both values kept. `rejected_value_json` NOT NULL-able would be
-- the silent overwrite this stage exists to prevent, so it is nullable only in the type, never in
-- practice, and Java's enforcer already raises CONFLICT_NOT_PRESERVED when it arrives empty.
CREATE TABLE dataset_conflicts (
  id                  CHAR(36)     NOT NULL,
  dataset_id          CHAR(36)     NOT NULL,
  workspace_id        CHAR(36)     NOT NULL,
  row_id              CHAR(36)     NOT NULL,
  column_key          VARCHAR(120) NOT NULL,
  kept_value_json     JSON         NULL,
  rejected_value_json JSON         NULL,
  kept_sources_json   JSON         NULL,
  rejected_sources_json JSON       NULL,
  resolved_by         VARCHAR(40)  NULL,
  created_at          DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_conflicts_row (row_id, column_key),
  KEY idx_conflicts_dataset (dataset_id),
  CONSTRAINT fk_conflict_row FOREIGN KEY (row_id) REFERENCES dataset_rows (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
