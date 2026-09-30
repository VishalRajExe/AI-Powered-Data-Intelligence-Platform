-- Phase 12: identity, tenancy and sessions.
--
-- Numbering: the audit reserved V3/V4 for identity and both slots gave way to code that existed
-- first — the dataset platform took V3, exports took V4. Identity is the last of the three to arrive,
-- so it lands here as V5. No applied migration was renumbered or edited; Flyway verifies checksums of
-- what it has run.
--
-- This migration also does the thing `docs/audit/00-FORENSIC-AUDIT.md` §5 item 2 asked for: the
-- `workspace_id` / `created_by_id` columns that were `NOT NULL` with no foreign key because no
-- `workspaces` or `users` table existed yet get their constraints. They can only be added *after*
-- the values already in those columns are made into real rows, so the second half of this file
-- backfills them from the data rather than inventing them.
--
-- Two rules shape the whole design:
--
-- **The tenant is never a number the migration guesses.** `FINALAGENT_WORKSPACE_ID` was an
-- environment value, so no DDL can know which row it named. The backfill therefore copies the
-- distinct values that already exist in the workflow, dataset and export tables into `workspaces`,
-- and the distinct actors into `users`. Anything a deployment had written keeps pointing at a row
-- that now genuinely exists, and nothing is fabricated that the database had not already been told.
--
-- **An actor that cannot log in is labelled, not hidden.** The pre-auth rows name
-- `00000000-0000-0000-0000-000000000000` as their author. That becomes a real user row with
-- `status = 'SERVICE'` and **`password_hash NULL`** — the only representation of "no human did this"
-- that cannot be mistaken for an account. The login path refuses a null hash, so it can never become
-- the backdoor the old project shipped as `demo@pirateagent.ai`.
--
-- There is no JWT secret here, and that is deliberate. Sessions are opaque random values whose
-- SHA-256 lives in `auth_sessions`; the browser holds a token it cannot read, forge or replay past
-- its expiry, and logout deletes a row instead of asking a stateless claim to behave. The audit's
-- requirement was that the frontend never receive a signing secret — it receives none, because none
-- exists to receive.

CREATE TABLE users (
  id              CHAR(36)      NOT NULL,
  -- Stored lowercased by the service; the unique index is the only thing that makes `Email` and
  -- `email` one account, and a duplicate login by case variation is the classic accidental
  -- two-identities bug.
  email           VARCHAR(320)  NOT NULL,
  display_name    VARCHAR(120)  NOT NULL,
  -- NULL means "this row cannot authenticate" — a service actor, not a disabled person. A bcrypt
  -- hash is 60 characters; 100 leaves room for a stronger algorithm without a schema change.
  password_hash   CHAR(60)      NULL,
  status          ENUM('ACTIVE','DISABLED','SERVICE') NOT NULL DEFAULT 'ACTIVE',
  failed_logins   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  -- Locked on the database clock, like every other deadline in this schema: an application clock
  -- that disagrees about "not yet" turns a lockout into either nothing or a permanent block.
  locked_until    DATETIME(6)   NULL,
  last_login_at   DATETIME(6)   NULL,
  password_set_at DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_email (email),
  KEY idx_users_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE workspaces (
  id            CHAR(36)     NOT NULL,
  name          VARCHAR(160) NOT NULL,
  -- PERSONAL is created with the account and is where a single-user deployment's data lives. TEAM
  -- exists so membership means something now rather than being added later under duress.
  kind          ENUM('PERSONAL','TEAM') NOT NULL DEFAULT 'PERSONAL',
  created_by_id CHAR(36)     NULL,
  created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                             ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_workspaces_creator (created_by_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE workspace_members (
  workspace_id  CHAR(36) NOT NULL,
  user_id       CHAR(36) NOT NULL,
  -- One ladder, checked in code at the one place that reads it: VIEWER reads, EDITOR creates and
  -- exports, OWNER does those plus membership. A role that is not in this order is a bug, not a
  -- third kind of access.
  role          ENUM('OWNER','EDITOR','VIEWER') NOT NULL DEFAULT 'EDITOR',
  created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (workspace_id, user_id),
  -- The other direction matters as much as the first: a PERSONAL workspace with no OWNER would be
  -- unreachable by anyone, and nothing here would say so.
  KEY idx_members_user (user_id, workspace_id),
  CONSTRAINT fk_member_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
      ON DELETE CASCADE,
  CONSTRAINT fk_member_user FOREIGN KEY (user_id) REFERENCES users (id)
      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE auth_sessions (
  id                CHAR(36)     NOT NULL,
  user_id           CHAR(36)     NOT NULL,
  workspace_id      CHAR(36)     NOT NULL,
  -- The session the caller presents, hashed. A readable value here would turn one leaked backup into
  -- every live session; an attacker with the table can neither use it nor tell two sessions apart.
  token_hash        CHAR(64)     NOT NULL,
  -- Rotation lineage. Refreshing revokes the parent and writes the child with the same `family_id`;
  -- a *revoked* family member presented again is not a stale client, it is a stolen token, and the
  -- response is to revoke the whole family.
  family_id         CHAR(36)     NOT NULL,
  created_by_ip     VARCHAR(45)  NULL,
  created_at        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  last_used_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at        DATETIME(6)  NOT NULL,
  absolute_expires_at DATETIME(6) NOT NULL,
  revoked_at        DATETIME(6)  NULL,
  revoke_reason     VARCHAR(40)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_session_token (token_hash),
  KEY idx_sessions_user (user_id, revoked_at, expires_at),
  KEY idx_sessions_family (family_id),
  KEY idx_sessions_expiry (revoked_at, expires_at),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_session_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------------------- legacy tenants and actors

-- `INSERT IGNORE`, not `INSERT`: the SELECTs below scan the workspace column of several tables and
-- the same tenant appears in all of them. The unique key makes a repeat a no-op rather than an error,
-- which is the pattern the rest of this schema already uses for duplicate work.
--
-- A fresh database with no rows contributes nothing here, and that is correct: a migration may not
-- invent a tenant the application has never written, because the id it invented would be the next
-- deployment's placeholder.
-- Every branch of the union names the same three columns. Written with one-column branches first,
-- and MySQL answered 1222 "The used SELECT statements have a different number of columns" — an error
-- message that names the mistake rather than the offending branch, which is why the shape is spelled
-- out fully here.
INSERT IGNORE INTO workspaces (id, name, kind)
  SELECT workspace_id, 'backfilled from workflow data', 'TEAM' FROM workflows
  UNION SELECT workspace_id, 'backfilled from a run', 'TEAM' FROM workflow_runs
  UNION SELECT workspace_id, 'backfilled from a plan', 'TEAM' FROM workflow_plans
  UNION SELECT workspace_id, 'backfilled from a dataset row', 'TEAM' FROM dataset_rows
  UNION SELECT workspace_id, 'backfilled from an export', 'TEAM' FROM export_jobs;

INSERT IGNORE INTO users (id, email, display_name, password_hash, status)
  SELECT created_by_id, CONCAT('service-', created_by_id, '@invalid.invalid'),
         'Pre-authentication actor', NULL, 'SERVICE'
    FROM workflows WHERE created_by_id IS NOT NULL
  UNION
  SELECT created_by_id, CONCAT('service-', created_by_id, '@invalid.invalid'),
         'Pre-authentication actor', NULL, 'SERVICE'
    FROM workflow_plans WHERE created_by_id IS NOT NULL;

-- The service actor row above is keyed on whatever the old rows named. `00000000-0000-0000-0000-
-- 000000000000` may not appear in a fresh database at all, so it is inserted directly: every future
-- machine-written event names it, and that name has to resolve to a row that cannot sign in.
INSERT IGNORE INTO users (id, email, display_name, password_hash, status)
  VALUES ('00000000-0000-0000-0000-000000000000', 'service-system@invalid.invalid',
          'This process, not a person', NULL, 'SERVICE');

-- The `.invalid` TLD is reserved and never deliverable, so a backfilled address cannot accidentally
-- become a real one that someone registers later.

-- --------------------------------------------------------------------- the constraints the audit asked for

ALTER TABLE workflows
  ADD CONSTRAINT fk_workflows_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  ADD CONSTRAINT fk_workflows_creator   FOREIGN KEY (created_by_id) REFERENCES users (id);

ALTER TABLE workflow_plans
  ADD CONSTRAINT fk_plans_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  ADD CONSTRAINT fk_plans_creator   FOREIGN KEY (created_by_id) REFERENCES users (id);

ALTER TABLE workflow_runs
  ADD CONSTRAINT fk_runs_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id);

ALTER TABLE workflow_steps
  ADD CONSTRAINT fk_steps_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id);

ALTER TABLE workflow_jobs
  ADD CONSTRAINT fk_jobs_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id);

ALTER TABLE activity_events
  ADD CONSTRAINT fk_events_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  ADD CONSTRAINT fk_events_actor      FOREIGN KEY (actor_id)     REFERENCES users (id);

ALTER TABLE datasets
  ADD CONSTRAINT fk_datasets_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id);

ALTER TABLE export_jobs
  ADD CONSTRAINT fk_exports_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  ADD CONSTRAINT fk_exports_requester FOREIGN KEY (requested_by_id) REFERENCES users (id);

-- RESTRICT everywhere above, deliberately: deleting a workspace that still has runs is not a cascade
-- an operator asked for, and `ON DELETE CASCADE` down a tenancy edge would turn one deleted row into
-- a silent data-loss event. Membership and sessions do cascade — they are attributes of a tenant,
-- not work a tenant did.
