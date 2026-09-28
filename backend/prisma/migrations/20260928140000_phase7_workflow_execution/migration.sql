ALTER TABLE `workflow_runs`
  ADD COLUMN `cancel_requested_at` DATETIME(3) NULL;

ALTER TABLE `workflow_steps`
  ADD COLUMN `retry_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN `source_ids` JSON NULL,
  ADD COLUMN `duration_ms` INTEGER UNSIGNED NULL;
