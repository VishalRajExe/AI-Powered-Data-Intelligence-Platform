# K. Environment Variables

**Rules (carried forward from the old `Rules.md:29` and strengthened):**

1. Environment variables only. Never hardcode a key, log a key, return a key in a response,
   expose one as a `NEXT_PUBLIC_*` variable, commit one, or place one in frontend source.
2. **One `.env` file**, at the repo root, consumed by all three services in development. The old
   project had `.env` and `backend/.env` as byte-identical duplicates — a config-drift hazard.
3. `.env` is gitignored; `.env.example` is committed and contains **names and safe defaults
   only, never values**. The old project's `backend/.env.example` was referenced by its README
   but did not exist.
4. **A missing required credential is a startup failure.** This is the single most important
   change. The old project substituted a demo implementation instead
   (`requirements/index.ts:17-19`, `planner/index.ts:19-21`, `server.ts:56-62`) and defaulted
   JWT secrets to literals (`server.ts:83-86`), so a misconfigured deployment *looked*
   functional. No variable below has an insecure fallback.
5. Database credentials stay server-side. The frontend receives **only** `NEXT_PUBLIC_API_URL`.
6. Secrets are masked in logs (Logback converter + Python log filter), porting the old Pino
   masking of tokens, hashes and connection URIs.

---

## K.1 Removed vs the old project

| Removed | Why |
|---|---|
| `REDIS_URL` | Redis excluded |
| `DEMO_MODE` | The demo layer is dropped entirely. Tests use mocks; production has one code path |
| `GOOGLE_GENERATIVE_AI_API_KEY` **and** `GEMINI_API_KEY` (both were set) | Standardize on `GEMINI_API_KEY`. Note the mismatch that would otherwise bite: PydanticAI's `google-gla` convention expects `GOOGLE_API_KEY`, the Vercel AI SDK expects `GOOGLE_GENERATIVE_AI_API_KEY`, and the old project set both. Our Python service reads `GEMINI_API_KEY` and maps it explicitly to the SDK — one name, one mapping, no guessing |
| `LLM_PROVIDER` multi-provider switch | v1 is Gemini-only. Keep the internal `LlmClient` interface so a second provider can be added deliberately, never as a silent default swap |
| Insecure literal fallbacks for `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | `server.ts:83-86` and `docker-compose.yml` both defaulted to guessable strings, making tokens forgeable. Now: absent ⇒ refuse to start |

## K.2 Root / shared

| Variable | Required | Default | Notes |
|---|---|---|---|
| `APP_ENV` | no | `development` | `development` \| `test` \| `production`. Seeds and dev-only routes refuse to run in `production` (preserving `prisma/seed.ts:3`) |
| `LOG_LEVEL` | no | `info` | |
| `FRONTEND_ORIGIN` | **yes** | — | Exact origin for CORS, e.g. `http://localhost:3000`. The old compose defaulted this to `http://localhost:5173` (a Vite port) while the frontend actually ran Next.js on 3000 and proxied to 4000 — the topology could never have worked |

## K.3 Spring Boot (`backend`)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `SERVER_PORT` | no | `8080` | **One documented port.** The old project used 4000 in `.env` and 3000 in compose, while the frontend hardcoded 4000 |
| `MYSQL_HOST` | yes | — | |
| `MYSQL_PORT` | no | `3306` | |
| `MYSQL_DATABASE` | yes | — | |
| `MYSQL_USER` | yes | — | |
| `MYSQL_PASSWORD` | **yes** | — | No default. The old compose defaulted to `development-password` |
| `SPRING_DATASOURCE_URL` | no | built from the `MYSQL_*` parts | Keep the old convenience of synthesizing the URL (`env.ts:99-105`), but never a default *credential* |
| `JWT_ACCESS_SECRET` | **yes** | — | ≥32 chars, validated at startup, no fallback |
| `JWT_REFRESH_SECRET` | **yes** | — | ≥32 chars, must differ from the access secret |
| `JWT_ACCESS_TTL_MINUTES` | no | `15` | |
| `JWT_REFRESH_TTL_DAYS` | no | `7` | |
| `AI_SERVICE_BASE_URL` | yes | `http://localhost:8000` | internal only; never exposed to the browser |
| `AI_SERVICE_API_KEY` | **yes** | — | shared secret for the Spring→Python boundary, constant-time compared |
| `JOB_CORE_POOL_SIZE` | no | `4` | |
| `JOB_MAX_POOL_SIZE` | no | `8` | |
| `JOB_QUEUE_CAPACITY` | no | `100` | `CallerRunsPolicy` gives backpressure |
| `JOB_LEASE_SECONDS` | no | `180` | renewed at `lease/3` |
| `JOB_STALE_SWEEP_SECONDS` | no | `30` | |
| `JOB_MAX_ATTEMPTS_DEFAULT` | no | `3` | plan steps may lower this, never raise it past the schema cap of 5 |
| `RATE_LIMIT_AUTH_PER_MIN` | no | `15` | |
| `RATE_LIMIT_WORKFLOW_PER_MIN` | no | `30` | |
| `SOURCE_ROBOTS_USER_AGENT` | no | `FinalAgentBot/1.0 (+contact-url)` | Identifying a crawler is correct behaviour; the old default was `ScoutlyBot` |
| `SOURCE_ROBOTS_TIMEOUT_MS` | no | `5000` | |
| `SOURCE_MAX_REQUESTS_PER_DOMAIN_PER_MIN` | no | `20` | global ceiling; a plan may go lower, never higher than 60 |
| `EXPORT_STORAGE_DIR` | no | `./storage/exports` | downloads are path-traversal-contained to it (`export.repository.ts:122-128`) |
| `EXPORT_CHUNK_SIZE` | no | `500` | |
| `EXPORT_TTL_HOURS` | no | `24` | **actually enforced** by the sweeper this time |
| `REQUEST_BODY_LIMIT` | no | `1mb` | |

## K.4 FastAPI (`ai-service`)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `AI_SERVICE_PORT` | no | `8000` | |
| `AI_SERVICE_API_KEY` | **yes** | — | must match the backend's value |
| `GEMINI_API_KEY` | **yes** | — | Absent ⇒ **startup failure**. No demo provider, no silent substitution |
| `LLM_MODEL_ID` | no | a pinned `gemini-2.5-flash`-class model | Pin the exact model; do not track a moving alias |
| `FIRECRAWL_API_KEY` | **yes** | — | Absent ⇒ startup failure. This was empty in the old `.env` while `DEMO_MODE=false`, so all collection was silently simulated |
| `FIRECRAWL_BASE_URL` | no | `https://api.firecrawl.dev` | Set this to point at a self-hosted Firecrawl and avoid per-call cloud credits (the `apiUrl` idea from the vendored fork's only delta) |
| `FIRECRAWL_SDK_VERSION` | build-time | pinned exact 4.x | Do not inherit the TS core's beta pin (`0.12.0-beta.2`) |
| `LLM_REQUEST_TIMEOUT_SECONDS` | no | `45` | |
| `EXTRACT_TIMEOUT_SECONDS` | no | `180` | |
| `INTERACT_TIMEOUT_SECONDS` | no | `60` | matches the upstream hard cap |
| `MAX_SCHEMA_REPAIRS` | no | `3` | ported constant |
| `MAX_COLLECT_CONCURRENCY` | no | `5` | `asyncio.Semaphore` size |
| `MARKDOWN_TRUNCATE_CHARS` | no | `4000` | `2000` when an extract is present |
| `ALLOWED_HOSTS` | no | `localhost` | defense in depth; the service should never be public |

## K.5 Next.js (`frontend`)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | no | `/api/v1` | The **only** variable the browser sees. Currently the frontend has zero `process.env` references and hardcodes `http://localhost:4000` in `next.config.js:15-22` |
| `API_PROXY_TARGET` | no | `http://localhost:8080` | dev-server rewrite target; server-side only |

No secret may ever be prefixed `NEXT_PUBLIC_`.

## K.6 `.env.example` skeleton (committed; names only)

```dotenv
# ---- shared ----
APP_ENV=development
LOG_LEVEL=info
FRONTEND_ORIGIN=http://localhost:3000

# ---- MySQL (no Redis anywhere in this project) ----
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=finalagent_dev
MYSQL_USER=
MYSQL_PASSWORD=

# ---- Spring Boot ----
SERVER_PORT=8080
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
AI_SERVICE_BASE_URL=http://localhost:8000
AI_SERVICE_API_KEY=
SOURCE_ROBOTS_USER_AGENT=FinalAgentBot/1.0 (+https://example.invalid/bot)

# ---- FastAPI AI service ----
GEMINI_API_KEY=
FIRECRAWL_API_KEY=
FIRECRAWL_BASE_URL=https://api.firecrawl.dev
LLM_MODEL_ID=

# ---- Next.js ----
NEXT_PUBLIC_API_URL=/api/v1
API_PROXY_TARGET=http://localhost:8080
```

Startup validation must assert: `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` present, ≥32 chars,
and different; `GEMINI_API_KEY` and `FIRECRAWL_API_KEY` present and non-empty; the two
`AI_SERVICE_API_KEY` values equal; `MYSQL_PASSWORD` non-empty. Any failure exits non-zero with a
message naming the variable. `/ready` reports the same checks at runtime.

## K.7 Local setup notes (from the environment audit)

- **MySQL** 9.6 is already installed and listening on 3306 (service `MySQL96`). Create
  `finalagent_dev` there. `docker-compose.yml` should pin `mysql:8.4` as the supported baseline.
- **Docker is not installed**, so compose-based setup is unavailable locally; run the three
  processes directly.
- **Python**: bare `python` resolves to the Windows Store alias and fails. Use `py -3.12` or a
  venv, and install 3.12 — the present 3.14.6 is too new for reliable wheels.
- **Java 21** and **Maven 3.9.11** are present and correct.

Next: `L-risks.md`.
