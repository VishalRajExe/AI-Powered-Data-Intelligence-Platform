# Memory.md — Living Project Memory

### Project: AI-Powered Data Intelligence Platform

## 1. Current Status

- **Current Phase:** Phase 1 — Foundation complete.
- **Last updated:** 2026-09-27.
- **App runnable end-to-end:** The API process starts and serves health/readiness routes. Product workflows are not implemented yet. A successful live MySQL 8 + Redis readiness check was not possible in this environment.
- **Repository state:** The workspace root has no `.git` directory, so no commit or push was made.

## 2. Completed Phases / Features

- [x] Phase 0 — Repository and architecture forensic audit completed in the prior session. The Firecrawl Agent Core is MIT licensed and was selected as the primary agent foundation; the local upstream snapshot had no Git metadata and the scoped package was unavailable from npm, so it is vendored as a local workspace package with provenance recorded.
- [x] Phase 1 — Node.js/TypeScript backend foundation, dependency configuration, health/readiness endpoints, Prisma and BullMQ setup, common middleware, tests, and developer documentation.
- [ ] Product phases — Not started. The checklist in `Phases.md` predates the current Phase 1 scope; follow the user's phase prompts and avoid inferring authorization to implement later phases.

## 3. Key Architectural Decisions Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-09-27 | Use an npm workspace monorepo with `backend/` and `packages/firecrawl-agent-core/`. | Keeps the server TypeScript-native and preserves the selected Firecrawl core as an isolated, traceable package. |
| 2026-09-27 | Vendor only Firecrawl Agent Core source and its MIT license; do not merge the other reference repositories. | The Agent Core package was not available from npm and the reference checkout had no Git metadata. Other repositories remain reference-only under their respective license/architecture constraints. |
| 2026-09-27 | Leave the Prisma schema without product domain models in Phase 1. | Workflow, ownership, and evidence relationships need a dedicated domain-design phase before schema commitment. |
| 2026-09-27 | Keep auth inactive; accept optional paired JWT secret settings for later auth work. | Authentication was not part of this foundation phase. |

## 4. Database / Schema Changes

- Added Prisma 6.12 configuration and a MySQL datasource in `backend/prisma/schema.prisma`.
- No product tables or migrations exist yet.
- `DATABASE_URL` can be configured directly or assembled from `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_DATABASE`.

## 5. Known Bugs / Issues / Verification Limits

- Docker is not installed in the current environment, so the checked-in MySQL 8.4 + Redis 7 Compose services could not be started.
- A local MySQL 9.6 instance was present, but Prisma could not authenticate because its `sha256_password` plugin was unsupported by the local client/runtime handshake. Redis was not listening on `127.0.0.1:6379`.
- `/ready` correctly returned 503 under those live conditions. Its successful response path is covered with dependency mocks in the API tests.
- No `.env` file was created. `.env.example` contains local development placeholders only.
- This workspace does not currently have Git metadata; commit/push requires a repository checkout to be initialized or provided.

## 6. Pending Work / Next Steps

- Stop after Phase 1 as requested; wait for the next phase prompt.
- When the environment is available, start MySQL 8.4 and Redis 7, then run `npm run db:validate` and verify `/ready` returns 200.
- Before syncing vendored Agent Core source, establish and record the exact upstream commit/tag and review its diff/license.

## 7. Environment / Commands / Configuration

- **Requirements:** Node.js 20+, npm; Docker Compose is used for local MySQL 8.4 and Redis 7.
- **Local setup:** `Copy-Item .env.example .env`; `docker compose up -d`; `npm install`; `npm run db:generate`; `npm run dev`.
- **Checks:** `npm run typecheck`; `npm run lint`; `npm test`; `npm run build`; `npm audit`.
- **Database validation:** `npm run db:validate`.
- **Environment variable names:** `APP_ENV`, `PORT`, `FRONTEND_ORIGIN`, `LOG_LEVEL`, `REQUEST_BODY_LIMIT`, `DATABASE_URL` or `MYSQL_HOST`/`MYSQL_PORT`/`MYSQL_USER`/`MYSQL_PASSWORD`/`MYSQL_DATABASE`, `REDIS_URL`, `FIRECRAWL_API_KEY`, `FIRECRAWL_BASE_URL`, `LLM_PROVIDER`, `LLM_MODEL_ID`, `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AI_GATEWAY_API_KEY`, `CUSTOM_OPENAI_API_KEY`, `CUSTOM_OPENAI_BASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`.
- **API:** `GET /health` checks process health; `GET /ready` checks MySQL and Redis. Auth and product routes are not active.
- **Data services:** `docker-compose.yml` defines MySQL 8.4 and Redis 7 with local port bindings and health checks.

## 8. Notes for the Next AI Session

- Read `PRD.md`, `Architecture.md`, `Rules.md`, `Phases.md`, `Design.md`, and this memory before starting new phase work.
- Backend foundation files are under `backend/`; the locally vendored Firecrawl package is under `packages/firecrawl-agent-core/`.
- Firecrawl and provider credentials are optional at startup and are required lazily when a collection run is invoked. Never add credentials to source control.
- Frontend is separate and must not be implemented in this project unless specifically requested.

## 9. Last Session Summary

Completed Phase 1 backend foundation: created npm workspaces, strict TypeScript configuration, centralized Zod environment parsing, structured Pino logging, Express security/CORS/request validation/error handling, `/health` and dependency-backed `/ready`, Prisma/MySQL and Redis/BullMQ wiring, local service Compose configuration, `.env.example`, tests, and backend setup documentation. Added validation for Redis URL schemes, frontend origin-only URLs, and request-size limits. Typecheck, lint, 9 tests, build, production dependency audit, and HTTP smoke checks passed. No application workflows or product tables were added. Live dependency readiness could not pass because Docker is unavailable, local MySQL auth is incompatible, and Redis is not running. No `.env` or Git metadata exists. Await the next phase.
