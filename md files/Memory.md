# Memory.md — Living Project Memory

### Project: AI-Powered Data Intelligence Platform

## 1. Current Status

- **Current Phase:** Phase 4 — Dynamic workflow planner complete.
- **Last updated:** 2026-09-27.
- **App runnable end-to-end:** Backend, requirement parsing, and persisted workflow planning are implemented. Collection execution remains out of scope until a later phase.
- **Git state:** `origin` is configured for `main`; phase work is pushed per the project request.

## 2. Completed Phases / Features

- [x] Phase 0 — Repository and architecture forensic audit. Firecrawl Agent Core is the primary foundation; its MIT source is vendored locally with provenance metadata. Other reference repositories were not merged.
- [x] Phase 1 — Backend workspace, strict TypeScript, Express foundation, environment validation, logging, Prisma/MySQL and Redis/BullMQ wiring, health/readiness, tests, and setup documentation.
- [x] Phase 2 — Workspace-scoped domain schema, two Prisma migrations, development seed, dataset row/provenance repository, and MySQL integration tests.
- [x] Phase 3 — Strict requirement schemas, configurable structured-output provider, prompt template, ambiguity/validation result, and `POST /api/v1/requirements/parse`.
- [x] Phase 4 — Strict versioned workflow plan schema, configurable LLM planner with one validation-correction attempt, workspace membership check, planning lifecycle persistence, and `POST /api/v1/workflows/plan`. No collection steps are executed.
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
| 2026-09-27 | Reuse the vendored Agent Core `resolveModel` through a requirement-provider interface; use AI SDK structured output and revalidate with Zod. | Uses the same configurable provider resolution as the agent while keeping requirement analysis independently mockable and free of collection tools. The direct `ai` dependency is pinned to the same 6.0.293 Apache-2.0 version already resolved for Agent Core. |
| 2026-09-27 | Return `needs_clarification` for unresolved entity, objective, fields, or explicit ambiguity; fail closed on malformed model output or provider errors. | Prevents invented requirements and ensures this stage cannot silently perform web collection. |
| 2026-09-27 | Add a separate workflow-planning service that uses the same Agent Core model resolver, only accepts the fixed step vocabulary, validates generated JSON with Zod, retries one invalid plan with issue feedback, and saves only validated versioned plans. | Keeps requirement understanding separate from planning, prohibits untrusted tool names, and makes the generated workflow inspectable before any execution phase. |
| 2026-09-27 | Persist workflow planning lifecycle (`NOT_STARTED`, `PLANNING`, `PLANNED`, `FAILED`) and sanitized failure details on Workflow; save the structured requirement and completion criteria in each WorkflowPlan. | Makes planning failures durable and allows plan versions to retain a complete input/output audit record. |

## 4. Database / Schema Changes

- Prisma 6.12 MySQL models are in `backend/prisma/schema.prisma`.
- Added users, workspaces, workspace members, workflows, versioned workflow plans, workflow runs, workflow steps, datasets, dataset columns/rows, sources, source evidence, validation issues, deduplication events, export jobs, and activity events.
- Added migrations `20260927143730_phase2_domain_model` and `20260927144412_workspace_membership_state` under `backend/prisma/migrations/`.
- Added migration `20260927161607_workflow_planning_state` for planning status/error fields and complete plan requirement/completion criteria.
- Seed command creates an idempotent development user/workspace only and refuses `APP_ENV=production`.
- Database tests run against local `aidp_dev` MySQL using credentials supplied transiently to the shell; credentials are not stored in source, `.env`, or this file.
- Requirement schema, provider, service, prompt, and route are under `backend/src/modules/requirements/` and `backend/src/routes/requirements.routes.ts`. API path is `POST /api/v1/requirements/parse`.
- Planner schema/provider/service/prompt are under `backend/src/modules/planner/`; persistence is in `backend/src/db/repositories/workflow-planner.repository.ts`, and the endpoint is in `backend/src/routes/workflows.routes.ts`.

## 5. Known Bugs / Issues / Verification Limits

- The live integration tests ran successfully against the installed MySQL 9.6 service. MySQL 8.4 remains the version in `docker-compose.yml`; Docker is unavailable here, so that exact service version was not started.
- Redis is not running locally; readiness was not rechecked in this phase. Phase 1 records that `/ready` returns 503 when required services are unavailable.
- Integration tests require `RUN_DATABASE_TESTS=true` and a migrated disposable database. The normal `npm test` run skips these integration checks when that flag is absent.
- No live LLM request was made because no provider credentials are configured in this workspace. Parser and planner behavior/failures are covered with injected provider fixtures; live model behavior remains unverified.
- No `.env` file exists. `.env.example` contains placeholders.
- The requested remote is configured as `origin`; no credential values are stored in project files.

## 6. Pending Work / Next Steps

- Stop after Phase 4 as requested; wait for the next phase prompt.
- The planner endpoint creates and persists an inspectable workflow plan but does not enqueue a job, invoke Firecrawl, or scrape.
- Authentication is not implemented. For now `createdById` is supplied by the caller and checked against active workspace membership; a future auth phase must bind it to an authenticated principal.
- `Phases.md` uses older phase numbering; follow the user's current phase prompts and do not build its later planner phase early.
- Before syncing Firecrawl Agent Core, establish and record the exact upstream commit/tag and review its diff/license.

## 7. Environment / Commands / Configuration

- **Requirements:** Node.js 20+, npm, MySQL 8+; Docker Compose provides local MySQL 8.4 and Redis 7 when available.
- **Local setup:** `Copy-Item .env.example .env`; `docker compose up -d`; `npm install`; `npm run db:generate`; `npm run db:migrate --workspace @aidp/backend -- --name init`; `npm run db:seed`; `npm run dev`.
- **Migration deploy:** `npm run db:deploy`.
- **Checks:** `npm run typecheck`; `npm run lint`; `npm test`; `npm run test:db` with `RUN_DATABASE_TESTS=true` and `DATABASE_URL`; `npm run build`; `npm audit`.
- **Schema validation:** `npm run db:validate`.
- **Environment variables:** `APP_ENV`, `PORT`, `FRONTEND_ORIGIN`, `LOG_LEVEL`, `REQUEST_BODY_LIMIT`, `DATABASE_URL` or `MYSQL_HOST`/`MYSQL_PORT`/`MYSQL_USER`/`MYSQL_PASSWORD`/`MYSQL_DATABASE`, `REDIS_URL`, `FIRECRAWL_API_KEY`, `FIRECRAWL_BASE_URL`, `LLM_PROVIDER`, `LLM_MODEL_ID`, provider credentials, and paired `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` when auth is introduced.
- **API:** `GET /health`, `GET /ready`, `POST /api/v1/requirements/parse`, and `POST /api/v1/workflows/plan`. Both AI routes require configured `LLM_PROVIDER`, `LLM_MODEL_ID`, and provider credential. Planning requires active workspace membership, returns a persisted plan, and does not execute collection. Authentication and collection execution are not active.
- **Data services:** `docker-compose.yml` defines local MySQL 8.4 and Redis 7.

## 8. Notes for the Next AI Session

- Read `PRD.md`, `Architecture.md`, `Rules.md`, `Phases.md`, `Design.md`, and this memory before starting new phase work.
- Backend sources are under `backend/src/`; Prisma schema, migrations, and seed are under `backend/prisma/`.
- Dataset row persistence must go through `DatasetRepository.insertRowWithEvidence` to preserve the source-evidence invariant.
- Frontend is separate and must not be implemented unless specifically requested.

## 9. Last Session Summary

Completed Phase 4. Added a strict typed plan contract with safe step vocabulary, bounded retry/timeouts, source policy, extraction/transform/validation/deduplication schemas, and completion criteria. The planner uses the configured Agent Core model resolver and structured output, validates against Zod, provides one correction attempt, and persists version 1 plus success/failure lifecycle details in MySQL. Added `POST /api/v1/workflows/plan`; it does not execute web collection. Tests cover valid and requirement-specific plans, malformed and unsupported output, absent extraction/completion contracts, retry validation, ambiguity, API validation, and MySQL plan persistence. Typecheck, lint, 33 unit tests, 3 MySQL integration tests, and build passed. No live LLM call was possible without provider credentials; MySQL verification used the local MySQL 9.6 service. No `.env` was created. Stop and wait for the next phase.
