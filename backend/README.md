# Backend foundation

Requires Node.js 20+ and Docker Compose for local MySQL 8.4 and Redis services.

```powershell
Copy-Item .env.example .env
docker compose up -d
npm install
npm run db:generate
npm run db:migrate --workspace @aidp/backend -- --name init
npm run db:seed
npm run dev
```

The API listens on `PORT` (default 3000). `GET /health` reports process health;
`GET /ready` probes MySQL and Redis. The endpoint does not require Firecrawl or
LLM credentials; those are validated when collection is requested. Authentication
is not active in this phase, so JWT secrets may remain empty.

Useful checks:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

The Prisma schema stores users, workspace memberships, versioned workflows and plans,
workflow runs and steps, datasets and dynamic columns/rows, sources and field evidence,
validation issues, deduplication decisions, export jobs, and activity events. Dataset
row values and versioned plans are JSON because their shapes vary by workflow; raw page
bodies are not stored. Tenant-scoped compound foreign keys and indexes support
workspace isolation and keyset-friendly dataset pagination.

`npm run db:seed` is development-only and refuses to run with `APP_ENV=production`.
It creates an example user and workspace without a password or login credentials.

Database integration checks use the configured `DATABASE_URL` and a migrated,
disposable development database:

```powershell
$env:RUN_DATABASE_TESTS = "true"
npm run test:db
```

Use `npm run db:deploy` to apply checked-in migrations in deployed environments.

## Requirement parsing API

`POST /api/v1/requirements/parse` accepts `{ "prompt": "..." }` and returns
`parsedRequirement`, `validationStatus` (`valid` or `needs_clarification`),
`warnings`, and `missingInformation`. It performs structured LLM analysis only;
it does not discover sources or run Firecrawl tools. Configure `LLM_PROVIDER`,
`LLM_MODEL_ID`, and the matching provider credential before calling it. The
parser uses the Agent Core provider resolver and validates generated output
against strict Zod schemas before returning it.

## Workflow planning API

`POST /api/v1/workflows/plan` accepts a validated structured requirement with
`workspaceId`, `createdById`, and an optional `originalPrompt`. The API requires
an active membership for the supplied user and workspace, stores a workflow in
`PLANNING`, and asks the configured LLM for a requirement-specific plan. It
allows one schema-correction attempt, validates the complete result, then saves
version 1 and sets `planningStatus` to `PLANNED`. A terminal model or validation
failure sets the workflow to `FAILED` with a sanitized error code/message. The
response contains the `workflowId`, typed `plan`, and planning status. This
phase only plans and persists; it does not execute SEARCH, SCRAPE, browser, or
worker operations. Since authentication is not active yet, `createdById` is
currently supplied by the caller; production authorization must bind this ID
to the authenticated principal when the auth phase is implemented.

Plans use a versioned strict Zod contract with a fixed safe step vocabulary,
bounded retries/timeouts, permitted-source policy, extraction schema, typed
transform/validation/deduplication rules, and measurable completion criteria.
Unsupported step types, missing fields, missing extraction schema, and missing
completion criteria are rejected before persistence.
