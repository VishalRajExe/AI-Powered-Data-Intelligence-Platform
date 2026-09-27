-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `password_hash` VARCHAR(255) NULL,
    `name` VARCHAR(160) NULL,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_uq`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workspaces` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `slug` VARCHAR(100) NOT NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `workspaces_slug_uq`(`slug`),
    INDEX `workspaces_creator_created_idx`(`created_by_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workspace_members` (
    `workspace_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `role` ENUM('OWNER', 'ADMIN', 'MEMBER') NOT NULL DEFAULT 'MEMBER',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workspace_members_user_created_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`workspace_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflows` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `requirement` TEXT NOT NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `workflows_workspace_status_updated_idx`(`workspace_id`, `status`, `updated_at`, `id`),
    INDEX `workflows_creator_created_idx`(`created_by_id`, `created_at`),
    UNIQUE INDEX `workflows_workspace_id_uq`(`workspace_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_plans` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `workflow_id` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `objective` TEXT NOT NULL,
    `constraints` JSON NULL,
    `sourcePolicy` JSON NOT NULL,
    `searchStrategy` JSON NOT NULL,
    `extractionSchema` JSON NOT NULL,
    `steps` JSON NOT NULL,
    `transformations` JSON NULL,
    `validationRules` JSON NULL,
    `deduplicationRules` JSON NULL,
    `outputConfiguration` JSON NULL,
    `plan_hash` CHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workflow_plans_workspace_workflow_created_idx`(`workspace_id`, `workflow_id`, `created_at`),
    UNIQUE INDEX `workflow_plans_workflow_version_uq`(`workflow_id`, `version`),
    UNIQUE INDEX `workflow_plans_workspace_workflow_id_uq`(`workspace_id`, `workflow_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_runs` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `workflow_id` CHAR(36) NOT NULL,
    `workflow_plan_id` CHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'PLANNING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `attempt` INTEGER NOT NULL DEFAULT 0,
    `progress` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `records_found` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `records_valid` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `duplicate_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `sources_processed` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `sources_failed` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `error_code` VARCHAR(100) NULL,
    `error_message` TEXT NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `workflow_runs_workspace_status_created_idx`(`workspace_id`, `status`, `created_at`, `id`),
    INDEX `workflow_runs_workflow_created_idx`(`workflow_id`, `created_at`, `id`),
    UNIQUE INDEX `workflow_runs_workspace_id_uq`(`workspace_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workflow_steps` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `workflow_run_id` CHAR(36) NOT NULL,
    `sequence` INTEGER UNSIGNED NOT NULL,
    `type` ENUM('PLAN', 'SEARCH', 'SCRAPE', 'INTERACT', 'EXTRACT', 'TRANSFORM', 'VALIDATE', 'DEDUPLICATE', 'MERGE', 'SAVE', 'EXPORT') NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED', 'BLOCKED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `attempt` INTEGER NOT NULL DEFAULT 0,
    `input` JSON NULL,
    `outputSummary` JSON NULL,
    `error_code` VARCHAR(100) NULL,
    `error_message` TEXT NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `workflow_steps_workspace_status_created_idx`(`workspace_id`, `status`, `created_at`),
    UNIQUE INDEX `workflow_steps_run_sequence_uq`(`workflow_run_id`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `datasets` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `workflow_run_id` CHAR(36) NOT NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('BUILDING', 'READY', 'PARTIAL', 'FAILED', 'ARCHIVED') NOT NULL DEFAULT 'BUILDING',
    `record_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `valid_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `duplicate_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `source_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `datasets_workflow_run_uq`(`workflow_run_id`),
    INDEX `datasets_workspace_status_updated_idx`(`workspace_id`, `status`, `updated_at`, `id`),
    INDEX `datasets_creator_created_idx`(`created_by_id`, `created_at`),
    UNIQUE INDEX `datasets_workspace_id_uq`(`workspace_id`, `id`),
    UNIQUE INDEX `datasets_workspace_id_run_uq`(`workspace_id`, `id`, `workflow_run_id`),
    UNIQUE INDEX `datasets_workspace_run_uq`(`workspace_id`, `workflow_run_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dataset_columns` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `dataset_id` CHAR(36) NOT NULL,
    `key` VARCHAR(128) NOT NULL,
    `label` VARCHAR(160) NOT NULL,
    `type` ENUM('STRING', 'NUMBER', 'BOOLEAN', 'DATE', 'DATETIME', 'URL', 'EMAIL', 'CURRENCY', 'JSON') NOT NULL,
    `position` INTEGER UNSIGNED NOT NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `filterable` BOOLEAN NOT NULL DEFAULT true,
    `sortable` BOOLEAN NOT NULL DEFAULT true,
    `config` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `dataset_columns_filterable_idx`(`workspace_id`, `dataset_id`, `filterable`, `position`),
    UNIQUE INDEX `dataset_columns_dataset_key_uq`(`dataset_id`, `key`),
    UNIQUE INDEX `dataset_columns_dataset_position_uq`(`dataset_id`, `position`),
    UNIQUE INDEX `dataset_columns_workspace_dataset_id_uq`(`workspace_id`, `dataset_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dataset_rows` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `dataset_id` CHAR(36) NOT NULL,
    `values` JSON NOT NULL,
    `confidence` DECIMAL(5, 4) NULL,
    `is_valid` BOOLEAN NOT NULL DEFAULT true,
    `duplicate_of_id` CHAR(36) NULL,
    `collected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `dataset_rows_dataset_created_idx`(`dataset_id`, `created_at`, `id`),
    INDEX `dataset_rows_dataset_valid_created_idx`(`dataset_id`, `is_valid`, `created_at`, `id`),
    INDEX `dataset_rows_dataset_duplicate_idx`(`dataset_id`, `duplicate_of_id`),
    UNIQUE INDEX `dataset_rows_workspace_dataset_id_uq`(`workspace_id`, `dataset_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sources` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `workflow_run_id` CHAR(36) NOT NULL,
    `dataset_id` CHAR(36) NULL,
    `url` TEXT NOT NULL,
    `canonical_url` TEXT NOT NULL,
    `canonical_url_hash` CHAR(64) NOT NULL,
    `domain` VARCHAR(255) NOT NULL,
    `title` VARCHAR(512) NULL,
    `status` ENUM('DISCOVERED', 'FETCHED', 'BLOCKED', 'SKIPPED', 'FAILED') NOT NULL DEFAULT 'DISCOVERED',
    `retrieved_at` DATETIME(3) NULL,
    `content_hash` CHAR(64) NULL,
    `error_code` VARCHAR(100) NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sources_workspace_domain_created_idx`(`workspace_id`, `domain`, `created_at`),
    INDEX `sources_dataset_retrieved_idx`(`dataset_id`, `retrieved_at`),
    UNIQUE INDEX `sources_run_url_hash_uq`(`workflow_run_id`, `canonical_url_hash`),
    UNIQUE INDEX `sources_workspace_id_uq`(`workspace_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `source_evidence` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `dataset_id` CHAR(36) NOT NULL,
    `dataset_row_id` CHAR(36) NOT NULL,
    `source_id` CHAR(36) NOT NULL,
    `dataset_column_id` CHAR(36) NULL,
    `field_key` VARCHAR(128) NULL,
    `evidence_type` VARCHAR(40) NOT NULL DEFAULT 'EXTRACTED',
    `snippet` VARCHAR(2000) NULL,
    `value_hash` CHAR(64) NULL,
    `confidence` DECIMAL(5, 4) NULL,
    `retrieved_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `source_evidence_row_column_idx`(`dataset_row_id`, `dataset_column_id`),
    INDEX `source_evidence_source_row_idx`(`source_id`, `dataset_row_id`),
    INDEX `source_evidence_workspace_dataset_created_idx`(`workspace_id`, `dataset_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `validation_issues` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `dataset_id` CHAR(36) NOT NULL,
    `dataset_row_id` CHAR(36) NOT NULL,
    `field_key` VARCHAR(128) NULL,
    `rule_code` VARCHAR(100) NOT NULL,
    `severity` ENUM('INFO', 'WARNING', 'ERROR') NOT NULL DEFAULT 'ERROR',
    `message` VARCHAR(1000) NOT NULL,
    `expected` JSON NULL,
    `actual` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `validation_issues_row_severity_idx`(`dataset_row_id`, `severity`),
    INDEX `validation_issues_workspace_dataset_created_idx`(`workspace_id`, `dataset_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deduplication_events` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `dataset_id` CHAR(36) NOT NULL,
    `workflow_run_id` CHAR(36) NOT NULL,
    `canonical_row_id` CHAR(36) NOT NULL,
    `duplicate_row_id` CHAR(36) NOT NULL,
    `decision` ENUM('LINKED', 'MERGED', 'KEPT_SEPARATE', 'REVIEW_REQUIRED') NOT NULL,
    `confidence` DECIMAL(5, 4) NULL,
    `matched_fields` JSON NULL,
    `reason` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `dedup_events_workspace_dataset_created_idx`(`workspace_id`, `dataset_id`, `created_at`),
    UNIQUE INDEX `dedup_events_run_duplicate_uq`(`workflow_run_id`, `duplicate_row_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `export_jobs` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `dataset_id` CHAR(36) NOT NULL,
    `requested_by_id` CHAR(36) NOT NULL,
    `format` ENUM('CSV', 'JSON', 'XLSX') NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `filters` JSON NULL,
    `sort` JSON NULL,
    `file_key` VARCHAR(1024) NULL,
    `expires_at` DATETIME(3) NULL,
    `error_code` VARCHAR(100) NULL,
    `error_message` TEXT NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `export_jobs_workspace_status_created_idx`(`workspace_id`, `status`, `created_at`, `id`),
    INDEX `export_jobs_dataset_created_idx`(`dataset_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activity_events` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `actor_id` CHAR(36) NULL,
    `action` VARCHAR(120) NOT NULL,
    `entity_type` VARCHAR(80) NOT NULL,
    `entity_id` CHAR(36) NOT NULL,
    `details` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `activity_workspace_created_idx`(`workspace_id`, `created_at`, `id`),
    INDEX `activity_workspace_entity_created_idx`(`workspace_id`, `entity_type`, `entity_id`, `created_at`),
    INDEX `activity_actor_created_idx`(`actor_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `workspaces` ADD CONSTRAINT `workspaces_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflows` ADD CONSTRAINT `workflows_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflows` ADD CONSTRAINT `workflows_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_plans` ADD CONSTRAINT `workflow_plans_workspace_id_workflow_id_fkey` FOREIGN KEY (`workspace_id`, `workflow_id`) REFERENCES `workflows`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_runs` ADD CONSTRAINT `workflow_runs_workspace_id_workflow_id_fkey` FOREIGN KEY (`workspace_id`, `workflow_id`) REFERENCES `workflows`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_runs` ADD CONSTRAINT `workflow_runs_workspace_id_workflow_id_workflow_plan_id_fkey` FOREIGN KEY (`workspace_id`, `workflow_id`, `workflow_plan_id`) REFERENCES `workflow_plans`(`workspace_id`, `workflow_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workflow_steps` ADD CONSTRAINT `workflow_steps_workspace_id_workflow_run_id_fkey` FOREIGN KEY (`workspace_id`, `workflow_run_id`) REFERENCES `workflow_runs`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `datasets` ADD CONSTRAINT `datasets_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `datasets` ADD CONSTRAINT `datasets_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `datasets` ADD CONSTRAINT `datasets_workspace_id_workflow_run_id_fkey` FOREIGN KEY (`workspace_id`, `workflow_run_id`) REFERENCES `workflow_runs`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dataset_columns` ADD CONSTRAINT `dataset_columns_workspace_id_dataset_id_fkey` FOREIGN KEY (`workspace_id`, `dataset_id`) REFERENCES `datasets`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dataset_rows` ADD CONSTRAINT `dataset_rows_workspace_id_dataset_id_fkey` FOREIGN KEY (`workspace_id`, `dataset_id`) REFERENCES `datasets`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dataset_rows` ADD CONSTRAINT `dataset_rows_workspace_id_dataset_id_duplicate_of_id_fkey` FOREIGN KEY (`workspace_id`, `dataset_id`, `duplicate_of_id`) REFERENCES `dataset_rows`(`workspace_id`, `dataset_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sources` ADD CONSTRAINT `sources_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sources` ADD CONSTRAINT `sources_workspace_id_workflow_run_id_fkey` FOREIGN KEY (`workspace_id`, `workflow_run_id`) REFERENCES `workflow_runs`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sources` ADD CONSTRAINT `sources_workspace_id_dataset_id_workflow_run_id_fkey` FOREIGN KEY (`workspace_id`, `dataset_id`, `workflow_run_id`) REFERENCES `datasets`(`workspace_id`, `id`, `workflow_run_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `source_evidence` ADD CONSTRAINT `source_evidence_workspace_id_dataset_id_fkey` FOREIGN KEY (`workspace_id`, `dataset_id`) REFERENCES `datasets`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `source_evidence` ADD CONSTRAINT `source_evidence_workspace_id_dataset_id_dataset_row_id_fkey` FOREIGN KEY (`workspace_id`, `dataset_id`, `dataset_row_id`) REFERENCES `dataset_rows`(`workspace_id`, `dataset_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `source_evidence` ADD CONSTRAINT `source_evidence_workspace_id_source_id_fkey` FOREIGN KEY (`workspace_id`, `source_id`) REFERENCES `sources`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `source_evidence` ADD CONSTRAINT `source_evidence_workspace_id_dataset_id_dataset_column_id_fkey` FOREIGN KEY (`workspace_id`, `dataset_id`, `dataset_column_id`) REFERENCES `dataset_columns`(`workspace_id`, `dataset_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `validation_issues` ADD CONSTRAINT `validation_issues_workspace_id_dataset_id_fkey` FOREIGN KEY (`workspace_id`, `dataset_id`) REFERENCES `datasets`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `validation_issues` ADD CONSTRAINT `validation_issues_workspace_id_dataset_id_dataset_row_id_fkey` FOREIGN KEY (`workspace_id`, `dataset_id`, `dataset_row_id`) REFERENCES `dataset_rows`(`workspace_id`, `dataset_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deduplication_events` ADD CONSTRAINT `deduplication_events_workspace_id_dataset_id_fkey` FOREIGN KEY (`workspace_id`, `dataset_id`) REFERENCES `datasets`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deduplication_events` ADD CONSTRAINT `deduplication_events_workspace_id_workflow_run_id_fkey` FOREIGN KEY (`workspace_id`, `workflow_run_id`) REFERENCES `workflow_runs`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deduplication_events` ADD CONSTRAINT `deduplication_events_workspace_id_dataset_id_canonical_row__fkey` FOREIGN KEY (`workspace_id`, `dataset_id`, `canonical_row_id`) REFERENCES `dataset_rows`(`workspace_id`, `dataset_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deduplication_events` ADD CONSTRAINT `deduplication_events_workspace_id_dataset_id_duplicate_row__fkey` FOREIGN KEY (`workspace_id`, `dataset_id`, `duplicate_row_id`) REFERENCES `dataset_rows`(`workspace_id`, `dataset_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `export_jobs` ADD CONSTRAINT `export_jobs_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `export_jobs` ADD CONSTRAINT `export_jobs_workspace_id_dataset_id_fkey` FOREIGN KEY (`workspace_id`, `dataset_id`) REFERENCES `datasets`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `export_jobs` ADD CONSTRAINT `export_jobs_requested_by_id_fkey` FOREIGN KEY (`requested_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activity_events` ADD CONSTRAINT `activity_events_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activity_events` ADD CONSTRAINT `activity_events_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
