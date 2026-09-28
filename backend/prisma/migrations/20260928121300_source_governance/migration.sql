ALTER TABLE `sources`
  MODIFY `status` ENUM('DISCOVERED', 'ALLOWED', 'QUEUED', 'PROCESSING', 'COLLECTED', 'FETCHED', 'BLOCKED', 'SKIPPED', 'FAILED') NOT NULL DEFAULT 'DISCOVERED',
  ADD COLUMN `policy_reason` VARCHAR(1000) NULL,
  ADD COLUMN `robots_status` VARCHAR(40) NULL,
  ADD COLUMN `robots_checked_at` DATETIME(3) NULL,
  ADD COLUMN `attempt_count` INT NOT NULL DEFAULT 0,
  ADD COLUMN `last_attempt_at` DATETIME(3) NULL,
  ADD COLUMN `source_metadata` JSON NULL;

CREATE INDEX `sources_workspace_status_created_idx` ON `sources`(`workspace_id`, `status`, `created_at`);
