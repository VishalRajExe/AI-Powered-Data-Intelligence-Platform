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
| Google Custom Search (`GOOGLE_SEARCH_API_KEY`, `GOOGLE_CSE_ID`) | Not introduced, and not inherited from `web-research-agent-master`, which searches with Google CSE (`web_search_tool.py:7-14`). Firecrawl is the only web engine; a second search stack is what Phase 5 explicitly refused |
| An embedding provider (`text-embedding-3-small`, `chromadb`, per-request vector stores) | Not introduced. That repo ranks relevance by embedding cosine; ours is lexical (`app/curation/relevance.py`), because a second AI provider whose only job is ranking is a second system. Gate **Q1** is the honest open question |
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
| `JWT_ACCESS_SECRET` | **yes** *(auth phase)* | — | ≥32 chars, validated at startup, no fallback. Not read by anything before the authentication phase, so not yet required |
| `JWT_REFRESH_SECRET` | **yes** *(auth phase)* | — | ≥32 chars, must differ from the access secret. Same deferral |
| `JWT_ACCESS_TTL_MINUTES` | no | `15` | |
| `JWT_REFRESH_TTL_DAYS` | no | `7` | |
| `AI_SERVICE_BASE_URL` | yes | `http://localhost:8000` | internal only; never exposed to the browser |
| `AI_SERVICE_API_KEY` | **yes** | — | shared secret for the Spring→Python boundary, constant-time compared |
| `AI_SERVICE_TIMEOUT_MS` | no | `3000` | The requirement-analysis client only. The **research** call gets its own `RestClient` with `min(300 s, WORKFLOW_STEP_TIMEOUT_MS + 5 s)`, because a collection run is minutes, not milliseconds, and one knob cannot govern both |
| `WORKFLOW_EXECUTION_ENABLED` | no | `false` | Turns the queue on **and** turns Flyway on. Off, the service still answers health, requirement parsing and ad-hoc research honestly, instead of refusing to boot over a database it does not use |
| `FINALAGENT_WORKSPACE_ID` | **yes** when enabled | — | The tenancy root, read from configuration and **never from a request** — the old `datasets.routes.ts:13` defect. Replaced by the token's workspace claim in the authentication phase |
| `WORKFLOW_POLL_INTERVAL_MS` | no | `500` | Bounded 100-60000 at startup: below that is a table scan every few milliseconds |
| `WORKFLOW_BATCH_SIZE` | no | `4` | Jobs claimed per pass, and expired leases swept per pass. Bounded 1-32 |
| `WORKFLOW_CORE_POOL_SIZE` / `WORKFLOW_MAX_POOL_SIZE` | no | `4` / `8` | The claim gate is a **semaphore of `maxPoolSize` permits**, not the pool's queue: a claimed job waiting behind 200 others is a job whose lease expires and which then runs twice |
| `WORKFLOW_QUEUE_CAPACITY` | no | `100` | Bounded 1-10000 |
| `WORKFLOW_LEASE_SECONDS` | no | `300` | Bounded 10-3600. A dead worker holds its jobs for one lease, no longer |
| `WORKFLOW_HEARTBEAT_SECONDS` | no | `30` | Bounded ≥5 and **strictly shorter than the lease** — a heartbeat that outlives its lease renews nothing |
| `WORKFLOW_MAX_ATTEMPTS` | no | `3` | Bounded 1-10. `attempt_count` increments on the claim, so the count that decides exhaustion is the count actually spent |
| `WORKFLOW_BACKOFF_BASE_SECONDS` / `WORKFLOW_BACKOFF_MAX_SECONDS` | no | `1` / `120` | `min(cap, base · 2^(attempt-1))` plus up to 30 % jitter; the ceiling may not be below the base |
| `WORKFLOW_STEP_TIMEOUT_MS` | no | `240000` | Bounded 1000-300000 and **must be shorter than the lease**, or a step outlives its own lease and two workers run one step |
| `JOB_STALE_SWEEP_SECONDS` | — | — | **Not a variable.** Sweeping is `WORKFLOW_BATCH_SIZE` expired leases inside the same loop that claims, so a separate interval would be a second clock to keep honest |
| `SOURCE_MAX_REQUESTS_PER_DOMAIN_PER_MIN` | no | `20` | Produced as `SearchStrategy.max_requests_per_domain_per_minute` and reported, but **consumed by nothing yet** — the unbuilt host-resolution phase owns it |
| `RATE_LIMIT_AUTH_PER_MIN` | no | `15` | |
| `RATE_LIMIT_WORKFLOW_PER_MIN` | no | `30` | |
| `SOURCE_ROBOTS_USER_AGENT` | no | `FinalAgentBot/1.0 (+contact-url)` | Identifying a crawler is correct behaviour; the old default was `ScoutlyBot`. **Not read yet:** robots is fetched in Python (`ROBOTS_USER_AGENT`, K.4), which is where the fetch actually happens. This one stays for the host-resolution phase |
| `SOURCE_ROBOTS_TIMEOUT_MS` | no | `5000` | *(same note)* |
| `EXPORT_STORAGE_DIR` | no | `./storage/exports` | downloads are path-traversal-contained to it (`export.repository.ts:122-128`) |
| `EXPORT_CHUNK_SIZE` | no | `500` | |
| `EXPORT_TTL_HOURS` | no | `24` | **actually enforced** by the sweeper this time |
| `REQUEST_BODY_LIMIT` | no | `1mb` | |

**Renamed at Phase 7.** The audit's `JOB_*` names became `WORKFLOW_*`, so one prefix covers the
layer and its bounds are all listed in one place. `JOB_LEASE_SECONDS`'s `180` became
`WORKFLOW_LEASE_SECONDS` `300`: the default step budget (240 s) has to fit inside a lease with room
to spare, and the startup validator refuses the pairing — which is how the original numbers were
found to contradict each other (`Memory.md` §2 P14). `JOB_MAX_ATTEMPTS_DEFAULT` became
`WORKFLOW_MAX_ATTEMPTS` with a hard 1-10 range instead of a plan-overridable default, because a step
cannot currently lower it either — `max_attempts` is stamped at enqueue from configuration, and a
per-step override would need the plan schema to carry it first.

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
| `SEARCH_TIMEOUT_SECONDS` | no | `30` | Added at Phase 4: `search` had been borrowing `INTERACT_TIMEOUT_SECONDS`, so one knob governed two unrelated deadlines |
| `SCRAPE_TIMEOUT_SECONDS` | no | `60` | |
| `INTERACT_TIMEOUT_SECONDS` | no | `60` | Hard cap for **one browser session**, ported from `toolkit.ts:4`. Upstream allows `<= 0` to mean "no deadline"; this service rejects it, because a stuck session would then hang the loop unbounded |
| `MAX_SCHEMA_REPAIRS` | no | `3` | ported constant |
| `MAX_COLLECT_CONCURRENCY` | no | `5` | `asyncio.Semaphore` size for search/scrape |
| `MAX_INTERACT_CONCURRENCY` | no | `2` | Separate, smaller cap for browser sessions. Upstream bars them from parallel workers entirely (`worker/index.ts:61`) |
| `ALLOWED_WEB_TOOLS` | no | `search,scrape` | The **ceiling** of web tools this service may ever use. A request may name a subset; it can never add a tool. `interact` is off until an operator turns it on here, because it is the one tool that acts on a page rather than reading it |
| `MAX_INTERACTIONS_PER_RUN` | no | `3` | Per-run cap on browser sessions, clamped downward from this value by the same request rule. `0` disables interact even when the ceiling allows it |
| `MAX_LOOPS` / `MAX_SEARCH_RESULTS` / `MAX_SEARCHES_PER_RUN` / `MAX_SCRAPES_PER_RUN` | no | `6` / `5` / `8` / `12` | Research-graph bounds; every one is checked before the tool runs, not only at the router |
| `SKILLS_DIR` | no | `skills/definitions` | Root of `SKILL.md` site playbooks. Relative paths resolve against the `ai-service` directory. **A missing or empty directory is valid** — the run simply has no playbooks; see `ai-service/skills/README.md` and gate **S1** |
| `RETRY_MAX_ATTEMPTS` | no | `3` | Bounded 1-5, the same range `app.contracts.RetryPolicy` enforces. Applies to web **reads** only |
| `RETRY_BASE_DELAY_SECONDS` / `RETRY_MAX_DELAY_SECONDS` | no | `1` / `20` | Exponential backoff with jitter into [0.5×, 1.5×], capped. The cap is the part `web-research-agent-master` omitted; its ceiling may not be below the first delay, or it would be silently ignored |
| `ROBOTS_ENABLED` | no | `true` | Reading robots.txt before a scrape or a browser session is the default, not an option |
| `ROBOTS_TIMEOUT_SECONDS` | no | `5` | Per-origin `robots.txt` GET, stdlib `urllib` on a worker thread; 64 KiB read cap |
| `ROBOTS_USER_AGENT` | no | `finalagent-research` | **One word required.** robots rules match on user-agent substrings, so a phrase would match unpredictably — and it is the token we identify ourselves with |
| `ROBOTS_ON_ERROR` | no | `restrict` | `restrict` refuses an unreadable robots file and reports it; `allow` fetches anyway and marks the run as having proceeded without a readable policy. 401/403/404/405 mean *no rules* (RFC 9309 §2.3.1), not an error — gate **Q2** asks whether `restrict` stays |
| `MIN_RELEVANCE_SCORE` | no | `0.0` | 0.0 ranks without dropping anything, so the scrape budget decides how many pages are read. Lexical scale, saturating at four matched terms — not a probability; gate **Q1** |
| `MAX_SOURCES_PER_DOMAIN` | no | `2` | Candidates per publisher per search batch; 0 disables the rule. `root_domain()` is a last-two-labels heuristic, documented as one |
| `MAX_CANDIDATES_PER_SEARCH` | no | `8` | How many ranked candidates the tool result shows the model; the rest are reported as excluded, not hidden |
| `ENTITY_MATCH_THRESHOLD` | no | `0.94` | Data-intelligence entity resolution (Phase 8). Name similarity **alone** never merges — a shared stable identifier is required, and a pair clearing this threshold without one becomes `REVIEW_REQUIRED`. Inherited from the old `EntityResolutionService.ts:24` because it is the conservative number, not because it was measured here; the per-request `entityMatchThreshold` can narrow it. Gate: never tuned on live data |
| `QUALITY_MAX_BLOCK_SIZE` | no | `400` | Records sharing one blocking key before the block is reported and left uncompared. It is what keeps a pathological key (every record with an empty name) from turning dedup and resolution into a quadratic scan; an oversized block appears in the stage notes rather than silently reducing coverage |
| `MARKDOWN_TRUNCATE_CHARS` | no | `4000` | `2000` when an extract is present |
| `ALLOWED_HOSTS` | no | `localhost` | defense in depth; the service should never be public |

## K.5 Next.js (`frontend`)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `BACKEND_ORIGIN` | no | `http://localhost:8080` | Server-side only. The Next.js server rewrites `/api/v1/:path*` to it, so the browser needs no backend origin and receives no credential. **Renamed from the planned `API_PROXY_TARGET`; `NEXT_PUBLIC_API_URL` is dropped entirely** — with the rewrite in place there is no variable the browser must know, so there is no `NEXT_PUBLIC_*` surface at all. |

**Build-time caveat found in Phase 1:** `next build` resolves the rewrite into
`.next/routes-manifest.json` and `next start` never re-reads `next.config.js`. In compose,
`BACKEND_ORIGIN` must therefore be supplied as **both** a build argument and a runtime
environment variable; setting only the latter silently keeps the value baked into the image.

No secret may ever be prefixed `NEXT_PUBLIC_`.

## K.6 `.env.example`

**The committed `.env.example` at the repository root is the single source of truth for variable
names.** This document deliberately does not restate it — a second copy of the same list is
exactly how the old project's 1,483-line hand-written `openapi.spec.ts` drifted from the routes it
claimed to describe. Read `.env.example`; the tables above explain why each variable exists.

`scripts/bootstrap-env.sh` creates `.env` from it and generates `AI_SERVICE_API_KEY`,
`MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD`, then prints which names are still empty. It never
prints a value.

Startup validation, as implemented and verified in Phase 1:

| Rule | Enforced by | Verified how |
|---|---|---|
| `AI_SERVICE_API_KEY` present, ≥32 chars, not a placeholder | `StartupRequirementsValidator` + `app/config.py` | **exit 1 observed** |
| `MYSQL_PASSWORD` present, ≥8 chars, not a placeholder | same | **exit 1 observed** |
| `MYSQL_USER`, `MYSQL_HOST`, `MYSQL_DATABASE` present | same | unit-tested |
| `GEMINI_API_KEY` / `FIRECRAWL_API_KEY` present, ≥12 chars, not a placeholder | `app/config.py` | **exit 1 observed** |
| `FRONTEND_ORIGIN` an exact origin — no wildcard, no path | `StartupRequirementsValidator` | unit-tested |
| `AI_SERVICE_BASE_URL` absolute http(s) | same | unit-tested |
| Port and timeout ranges | same + `app/config.py` | unit-tested |
| `ALLOWED_WEB_TOOLS` names only implemented tools, and at least one | `app/config.py` | unit-tested — `crawl` and an empty list each abort startup |
| `MAX_INTERACTIONS_PER_RUN` 0–20, `MAX_INTERACT_CONCURRENCY` 1–4 | `app/config.py` | unit-tested |
| Every timeout, `SEARCH_TIMEOUT_SECONDS` included, must be > 0 | `app/config.py` | unit-tested; upstream's "`<= 0` means no deadline" for interact is refused here on purpose |
| A request cannot widen the tool ceiling or buy more sessions than it | `resolve_limits()` in `app/api/v1/research.py`, `WebToolPolicy` in Java | `test_the_intersection_is_reported_back_to_the_caller`, `WebToolPolicyTest` |
| `SKILLS_DIR` may point at a missing directory | `SkillLibrary` / `discover_skills` | unit-tested — an absent root is an empty library, not an error |
| `RETRY_MAX_ATTEMPTS` 1-5, backoff ceiling ≥ first delay | `app/config.py` + `RetryPolicy` | unit-tested |
| `ROBOTS_USER_AGENT` is a single non-blank token; `ROBOTS_ON_ERROR` ∈ {restrict, allow} | `app/config.py` | unit-tested — a phrase agent is refused, `ignore` is refused |
| `MIN_RELEVANCE_SCORE` ∈ [0,1], `MAX_SOURCES_PER_DOMAIN` ∈ [0,10], `MAX_CANDIDATES_PER_SEARCH` ∈ [1,20] | `app/config.py` | unit-tested |
| `ENTITY_MATCH_THRESHOLD` ∈ [0.5,1.0], `QUALITY_MAX_BLOCK_SIZE` ∈ [2,100000]; the same range re-checked on the per-request override | `app/config.py` + `app/quality/contracts.py` | unit-tested — `test_config.py`, `test_quality_api.py` (`test_out_of_range_bounds_are_refused_rather_than_silently_clamped`); a 0.4 threshold or a 1-record block stops the service at boot instead of quietly changing what a merge means |
| Java refuses an impossible curation request before calling Python | `SourceCurationPolicy.java` | `SourceCurationPolicyTest` (10), `ResearchControllerTest.anImpossibleRelevanceFloorIsRejectedLocally` |
| Placeholder values rejected (`REPLACE_ME`, `changeme`, `insecure-default`, …) | both services | unit-tested |
| Every problem reported at once; values never echoed into the message | both services | unit-tested |
| The two `AI_SERVICE_API_KEY` values agree | `X-API-Key` constant-time compare | **401 observed** |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` present, ≥32, distinct | **deferred to the authentication phase** | nothing reads them yet, so requiring them now would be theatre |

## K.7 Local setup notes (from the environment audit)

- **MySQL** 9.6 is installed and listening on 3306 (service `MySQL96`). `finalagent_dev` still has
  no matching application user, so `/ready` reports `mysql: DOWN` locally until one is granted;
  that is the honest state, not a defect. `database/docker-compose.yml` publishes its own
  container on host **3307** so it can sit alongside the native service.
- **Docker is not installed**, so nothing in `database/` or `deploy/` has been built. Run the
  three processes directly via `scripts/dev-*.sh`.
- **Python**: bare `python` resolves to the Windows Store alias and fails; use `py`. Phase 1 was
  installed and tested on **3.14.6** and the base dependencies (FastAPI, uvicorn, Pydantic v2,
  pydantic-settings, python-dotenv) resolved cleanly. The **provider SDKs** — `google-genai`,
  `firecrawl==4.45.0` — sit in the `collection` extra precisely because their wheels are the part
  not verified on 3.14. **3.12 remains the pinned deployment interpreter**; install it before the
  Phase 2 provider spike.
- **Java 21** (21.0.8) and **Maven 3.9.11** are present and correct; the backend is built and run
  with them.
- **Windows file locking**: a running `java -jar target/…jar` prevents Maven from replacing that
  jar, and `mvn package` then leaves a thin, non-bootable artifact behind. Stop the process before
  rebuilding. This cost a wasted debugging cycle in Phase 1.

Next: `L-risks.md`.
