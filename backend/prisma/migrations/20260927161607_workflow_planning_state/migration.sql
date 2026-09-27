/*
  Warnings:

  - Added the required column `completion_criteria` to the `workflow_plans` table without a default value. This is not possible if the table is not empty.
  - Added the required column `requirement` to the `workflow_plans` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `workflow_plans` ADD COLUMN `completion_criteria` JSON NOT NULL,
    ADD COLUMN `requirement` JSON NOT NULL;

-- AlterTable
ALTER TABLE `workflows` ADD COLUMN `planning_error_code` VARCHAR(100) NULL,
    ADD COLUMN `planning_error_message` VARCHAR(1000) NULL,
    ADD COLUMN `planning_status` ENUM('NOT_STARTED', 'PLANNING', 'PLANNED', 'FAILED') NOT NULL DEFAULT 'NOT_STARTED';
