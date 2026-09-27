# Backend foundation

Requires Node.js 20+ and Docker Compose for local MySQL 8.4 and Redis services.

```powershell
Copy-Item .env.example .env
docker compose up -d
npm install
npm run db:generate
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

The database schema intentionally has no product tables yet. Later feature phases
will add domain models after their workflow, ownership, and evidence relationships
are specified.
