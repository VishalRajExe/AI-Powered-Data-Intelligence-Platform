-- Phase 7: workflow definition. Schema is specified in docs/audit/E-database-model.md §E.2.
--
-- Numbering note: the audit's migration plan listed `V1__baseline_identity.sql` first, but
-- identity belongs to the authentication phase, which has not been built. Rather than create
-- empty tables to fill a slot, V1 is the first aggregate that has working code behind it and
-- later phases append V3, V4, … — an already-applied migration is never renumbered, because
-- Flyway verifies checksums of what it has run.
--
-- `workspace_id` and `created_by_id` are NOT NULL here but carry **no foreign key yet**: the
-- `workspaces` and `users` tables arrive with the authentication phase. That is a real gap, not
-- a design choice, and it is recorded in Memory.md as something the auth phase must close. Until
-- then the application accepts a workspace id from server-side configuration only — never from a
-- request body — which is the specific old-project defect (`datasets.routes.ts:13` trusted a
-- client-supplied `workspaceId`) this exists to avoid reproducing.

CREATE TABLE workflows (
  id                     CHAR(36)      NOT NULL,
  workspace_id           CHAR(36)      NOT NULL,
  created_by_id          CHAR(36)      NOT NULL,
  name                   VARCHAR(200)  NOT NULL,
  -- The user's prompt, verbatim. Nothing downstream may replace it with an interpretation.
  requirement_text       TEXT          NOT NULL,
  status                 ENUM('DRAFT','ACTIVE','PAUSED','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  planning_status        ENUM('NOT_STARTED','PLANNING','PLANNED','FAILED')
                                          NOT NULL DEFAULT 'NOT_STARTED',
  planning_error_code    VARCHAR(80)     NULL,
  planning_error_message VARCHAR(1000)   NULL,
  created_at             DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at             DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                          ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_workflow_scope (workspace_id, id),
  KEY idx_workflows_workspace (workspace_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Versioned and immutable once written: a run always points at the exact plan it executed, so a
-- re-planned workflow cannot silently change what an older run meant.
CREATE TABLE workflow_plans (
  id                  CHAR(36)      NOT NULL,
  workspace_id        CHAR(36)      NOT NULL,
  workflow_id         CHAR(36)      NOT NULL,
  version             INT UNSIGNED  NOT NULL,
  objective           TEXT          NOT NULL,
  requirement         JSON          NOT NULL,
  constraints         JSON          NULL,
  source_policy       JSON          NULL,
  search_strategy     JSON          NULL,
  extraction_schema   JSON          NOT NULL,
  steps               JSON          NOT NULL,
  transformations     JSON          NULL,
  validation_rules    JSON          NULL,
  deduplication_rules JSON          NULL,
  output_configuration JSON          NULL,
  completion_criteria JSON          NOT NULL,
  -- SHA-256 over the canonical serialisation of the plan. Change detection only: two plans with
  -- the same hash are the same plan, so a re-plan that produced nothing new is visible.
  plan_hash           CHAR(64)      NOT NULL,
  created_by_id       CHAR(36)      NOT NULL,
  created_at          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_plan_version (workflow_id, version),
  KEY idx_plans_workspace (workspace_id, workflow_id),
  CONSTRAINT fk_plans_workflow FOREIGN KEY (workflow_id) REFERENCES workflows (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
