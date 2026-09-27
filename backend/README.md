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
