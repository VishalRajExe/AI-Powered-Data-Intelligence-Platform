ALTER TABLE dataset_rows
  ADD COLUMN raw_values JSON NULL,
  ADD COLUMN quality_metadata JSON NULL,
  ADD COLUMN verification_status ENUM('SOURCE_CITED_UNVERIFIED', 'UNSUPPORTED', 'CONFLICTED') NOT NULL DEFAULT 'UNSUPPORTED';

CREATE TABLE data_quality_reports (
  id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  dataset_id CHAR(36) NOT NULL,
  workflow_run_id CHAR(36) NOT NULL,
  raw_record_count INTEGER UNSIGNED NOT NULL DEFAULT 0,
  normalized_record_count INTEGER UNSIGNED NOT NULL DEFAULT 0,
  valid_record_count INTEGER UNSIGNED NOT NULL DEFAULT 0,
  invalid_record_count INTEGER UNSIGNED NOT NULL DEFAULT 0,
  duplicate_count INTEGER UNSIGNED NOT NULL DEFAULT 0,
  review_required_count INTEGER UNSIGNED NOT NULL DEFAULT 0,
  conflict_count INTEGER UNSIGNED NOT NULL DEFAULT 0,
  source_backed_count INTEGER UNSIGNED NOT NULL DEFAULT 0,
  quality_score DECIMAL(5, 4) NULL,
  metrics JSON NOT NULL,
  computed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX data_quality_reports_dataset_uq(dataset_id),
  UNIQUE INDEX data_quality_reports_run_uq(workflow_run_id),
  UNIQUE INDEX data_quality_reports_workspace_id_uq(workspace_id, id),
  INDEX data_quality_reports_workspace_computed_idx(workspace_id, computed_at),
  PRIMARY KEY (id)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE data_quality_reports
  ADD CONSTRAINT data_quality_reports_workspace_dataset_fkey
    FOREIGN KEY (workspace_id, dataset_id) REFERENCES datasets(workspace_id, id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT data_quality_reports_workspace_workflow_run_fkey
    FOREIGN KEY (workspace_id, workflow_run_id) REFERENCES workflow_runs(workspace_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
