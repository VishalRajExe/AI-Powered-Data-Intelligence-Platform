# Memory.md — Living Project Memory

### Project: AI-Powered Data Intelligence Platform

## 1. Current Status

- **Current Phase:** Phase 2 — Database and domain model complete.
- **Last updated:** 2026-09-27.
- **App runnable end-to-end:** Backend foundation starts; product collection workflows and APIs are not implemented yet.
- **Git state:** Workspace is on `main` and tracks `origin/main`; Phase 2 changes are being prepared for the requested push.

## 2. Completed Phases / Features

- [x] Phase 0 — Repository and architecture forensic audit. Firecrawl Agent Core is the primary foundation; its MIT source is vendored locally with provenance metadata. Other reference repositories were not merged.
- [x] Phase 1 — Backend workspace, strict TypeScript, Express foundation, environment validation, logging, Prisma/MySQL and Redis/BullMQ wiring, health/readiness, tests, and setup documentation.
- [x] Phase 2 — Workspace-scoped domain schema, two Prisma migrations, development seed, dataset row/provenance repository, and MySQL integration tests.
- [ ] Later product phases — Not started. Follow the user's explicit phase prompts; do not infer authorization to implement later work.

## 3. Key Architectural Decisions Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-09-27 | Use npm workspaces with `backend/` and `packages/firecrawl-agent-core/`. | Keeps the server TypeScript-native and the selected agent core isolated and traceable. |
| 2026-09-27 | Vendor only Firecrawl Agent Core source and its MIT license; do not merge the other reference repositories. | The package was unavailable from npm and the local reference snapshot had no Git metadata. Other repositories remain reference-only under their license/architecture constraints. |
| 2026-09-27 | Use UUID strings and workspace IDs on tenant-owned entities, plus compound foreign keys for same-workspace workflow/run/dataset relationships. | Prevents accidental cross-workspace links and supports per-workspace queries. |
| 2026-09-27 | Store dynamic dataset values and versioned plan definitions as JSON; store dataset columns, evidence, validation issues, and deduplication decisions relationally. | Preserves flexible data contracts while keeping provenance and common metadata queryable. Raw page bodies are not persisted in MySQL. |
| 2026-09-27 | Require row creation through `DatasetRepository.insertRowWithEvidence`. | Persists row and evidence in one transaction, rejects rows without evidence, and verifies sources were fetched in the dataset's workflow run. |
| 2026-09-27 | Keep authentication inactive; retain nullable password hashes and workspace membership models for later auth phases. | Phase 2 defines persistence and ownership boundaries but does not implement login/session behavior. |

## 4. Database / Schema Changes

- Prisma 6.12 MySQL models are in `backend/prisma/schema.prisma`.
- Added users, workspaces, workspace members, workflows, versioned workflow plans, workflow runs, workflow steps, datasets, dataset columns/rows, sources, source evidence, validation issues, deduplication events, export jobs, and activity events.
- Added migrations `20260927143730_phase2_domain_model` and `20260927144412_workspace_membership_state` under `backend/prisma/migrations/`.
- Seed command creates an idempotent development user/workspace only and refuses `APP_ENV=production`.
- Database tests run against local `aidp_dev` MySQL using credentials supplied transiently to the shell; credentials are not stored in source, `.env`, or this file.

## 5. Known Bugs / Issues / Verification Limits

- The live integration tests ran successfully against the installed MySQL 9.6 service. MySQL 8.4 remains the version in `docker-compose.yml`; Docker is unavailable here, so that exact service version was not started.
- Redis is not running locally; readiness was not rechecked in this phase. Phase 1 records that `/ready` returns 503 when required services are unavailable.
- Integration tests require `RUN_DATABASE_TESTS=true` and a migrated disposable database. The normal `npm test` run skips these integration checks when that flag is absent.
- No `.env` file exists. `.env.example` contains placeholders.
- The requested remote is configured as `origin`; no credential values are stored in project files.

## 6. Pending Work / Next Steps

- Stop after Phase 2 as requested; wait for the next phase prompt.
- No later API, auth, worker, or frontend work was started.
- Before syncing Firecrawl Agent Core, establish and record the exact upstream commit/tag and review its diff/license.

## 7. Environment / Commands / Configuration

- **Requirements:** Node.js 20+, npm, MySQL 8+; Docker Compose provides local MySQL 8.4 and Redis 7 when available.
- **Local setup:** `Copy-Item .env.example .env`; `docker compose up -d`; `npm install`; `npm run db:generate`; `npm run db:migrate --workspace @aidp/backend -- --name init`; `npm run db:seed`; `npm run dev`.
- **Migration deploy:** `npm run db:deploy`.
- **Checks:** `npm run typecheck`; `npm run lint`; `npm test`; `npm run test:db` with `RUN_DATABASE_TESTS=true` and `DATABASE_URL`; `npm run build`; `npm audit`.
- **Schema validation:** `npm run db:validate`.
- **Environment variables:** `APP_ENV`, `PORT`, `FRONTEND_ORIGIN`, `LOG_LEVEL`, `REQUEST_BODY_LIMIT`, `DATABASE_URL` or `MYSQL_HOST`/`MYSQL_PORT`/`MYSQL_USER`/`MYSQL_PASSWORD`/`MYSQL_DATABASE`, `REDIS_URL`, `FIRECRAWL_API_KEY`, `FIRECRAWL_BASE_URL`, `LLM_PROVIDER`, `LLM_MODEL_ID`, provider credentials, and paired `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` when auth is introduced.
- **API:** `GET /health` and `GET /ready` only; product routes and auth are not active.
- **Data services:** `docker-compose.yml` defines local MySQL 8.4 and Redis 7.

## 8. Notes for the Next AI Session

- Read `PRD.md`, `Architecture.md`, `Rules.md`, `Phases.md`, `Design.md`, and this memory before starting new phase work.
- Backend sources are under `backend/src/`; Prisma schema, migrations, and seed are under `backend/prisma/`.
- Dataset row persistence must go through `DatasetRepository.insertRowWithEvidence` to preserve the source-evidence invariant.
- Frontend is separate and must not be implemented unless specifically requested.

## 9. Last Session Summary

Completed Phase 2. Designed and migrated the workspace-scoped domain schema, added development-only seed data and an atomic dataset-row repository that requires fetched source evidence, and added MySQL integration coverage for migrations, CRUD/relationships, constraints, pagination, row insertion, and provenance. Both migrations applied to the local MySQL 9.6 `aidp_dev` database using the supplied root credentials through transient shell environment only. Typecheck, lint, normal tests (9 passed; DB suite skipped by default), DB integration tests (3 passed), build, schema validation, seed, and npm audit passed. No `.env` was created. Stop and wait for the next phase.
