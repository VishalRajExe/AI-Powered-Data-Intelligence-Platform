# deploy/

Full-stack containerization: MySQL + Spring Boot + FastAPI + Next.js, **no Redis**.

## Verification status — read this first

**Not verified on this machine.** Docker is not installed here (`docker: command not found`,
recorded as risk R12 in `../docs/audit/L-risks.md`), so the three `Dockerfile`s and
`docker-compose.yml` in this folder have never been built or run. They are written against the
same configuration contract that the *verified* native runs use, but treat the first
`docker compose up` as an untested path.

What **was** executed and passed, natively:

| Check | Result |
|---|---|
| `mvn test` | 27 passed |
| `java -jar backend-0.1.0.jar` boots, serves `/api/v1/health` and `/api/v1/ready` | passed |
| Missing credential ⇒ exit code 1 with the variables named | passed |
| `pytest` | 31 passed |
| `uvicorn app.main:app` boots, `/ai/v1/ready` rejects a bad key with 401 | passed |
| Backend → AI service over the shared key (readiness reported `aiService: UP`) | passed |
| `npm run typecheck` / `npm run build`, and all 10 routes served by `next start` | passed |

## Run it

```bash
cp .env.example .env      # or scripts/bootstrap-env.sh, which also generates the shared key
# fill MYSQL_USER, MYSQL_PASSWORD, MYSQL_ROOT_PASSWORD, GEMINI_API_KEY, FIRECRAWL_API_KEY
docker compose --env-file ../.env -f deploy/docker-compose.yml up -d --build
```

`--env-file` is required: Compose looks for `.env` next to the compose file, and this project
keeps exactly one `.env` at the repository root.

## Port map

| Service | Container | Host | Reachable from |
|---|---|---|---|
| Next.js | 3000 | `${FRONTEND_PUBLISH_PORT:-3000}` | the browser |
| Spring Boot | 8080 | `${BACKEND_PUBLISH_PORT:-8080}` | the browser (via the Next rewrite) and probes |
| FastAPI | 8000 | **not published** | the backend only, on the compose network |
| MySQL | 3306 | **not published** | the backend only |

The AI service and database are intentionally unexposed. In `database/docker-compose.yml` MySQL
*is* published, on host port **3307**, for developers running the other services natively
alongside an existing MySQL on 3306.

## Two behaviours worth knowing

1. **`BACKEND_ORIGIN` is baked at build time.** `next build` writes the resolved rewrite into
   `.next/routes-manifest.json`; `next start` never re-reads `next.config.js`. Both the build
   argument and the runtime environment variable are set in compose for exactly this reason.
2. **Liveness is not readiness.** The backend container's healthcheck calls
   `/actuator/health/liveness`, which stays `UP` while MySQL is down. Readiness — `/ready`,
   which reports MySQL, the AI service, and credential presence — answers 503. Coupling liveness
   to the database would make the orchestrator restart perfectly healthy processes in a loop
   during any DB outage.

## Secrets

Every secret in `docker-compose.yml` is declared as `${VAR:?…}`, so an unset value aborts the
compose command with a message. There is no default for any credential — the old project's
`insecure-default-…` fallbacks made its JWTs forgeable, and that failure mode is designed out
here rather than left to a reviewer to catch.
