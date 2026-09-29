# B. Final Technology Stack

Versions chosen for compatibility with what is actually installed on this machine
(Java 21.0.8, Maven 3.9.11, Node 24.19, MySQL 9.6 native, **no Docker**, Python 3.14 present but
unusable as-is). Every "why" below is traceable to an audit finding.

## B.1 Backend — Spring Boot (Java)

| Concern | Choice | Why |
|---|---|---|
| Language / runtime | **Java 21 LTS** | Installed. Virtual threads available, which matters for a job worker that blocks on HTTP |
| Framework | **Spring Boot 3.5.x** | Brief. Baseline is Java 17+; 21 is supported |
| Web | `spring-boot-starter-web` (Spring MVC) + `spring.threads.virtual.enabled=true` | MVC's `SseEmitter` is simpler than WebFlux for our SSE needs, and virtual threads remove the blocking-IO penalty. No reactive complexity anywhere |
| Security | `spring-boot-starter-security` + `spring-boot-starter-oauth2-resource-server` (Nimbus JOSE) | Gives JWT validation, filter chain and method security for free. Replaces the old project's hand-rolled middleware that was never actually mounted (`app.ts:71-74`) |
| Validation | `spring-boot-starter-validation` (Hibernate Validator) | Brief. Enforces the Requirement/Plan contracts at the boundary |
| Persistence | `spring-boot-starter-data-jpa` (Hibernate 6) + `mysql-connector-j` | Brief. Replaces Prisma |
| Migrations | **Flyway** (`flyway-core` + `flyway-mysql`) | Chosen over Liquibase and to be kept consistent. Reason: the schema uses MySQL-specific features (JSON columns, generated columns, `FOR UPDATE SKIP LOCKED` patterns, ENUMs), so SQL-first migrations are clearer than an XML/YAML abstraction. Versioned `V1__…sql` files are also easier to review in a viva |
| API docs | `springdoc-openapi-starter-webmvc-ui` | **Generates** the spec from controllers. The old project hand-wrote a 1,483-line `openapi.spec.ts` that drifted from the routes |
| Resilience | `resilience4j-spring-boot3` (Retry, TimeLimiter, Bulkhead) | Bounded retries, per-step timeouts and concurrency caps without Redis |
| Rate limiting | **Bucket4j** (in-memory, `bucket4j-core`) | Replaces the Redis Lua sliding window. Single-node only — documented constraint, see `A-final-architecture.md` §A.4 |
| Fuzzy matching | `commons-text` (`LevenshteinDistance`, `JaroWinklerSimilarity`) | Apache-2.0 ✅. Replaces the hand-rolled Levenshtein in the old `EntityResolutionService.ts:127-144` |
| XLSX export | Apache POI **SXSSF** (streaming) | Replaces ExcelJS streaming `WorkbookWriter`. Same chunked-write discipline |
| CSV / JSON export | Hand-rolled RFC 4180 writer + Jackson streaming (`JsonGenerator`) | The old implementation was already correct (`format-writers.ts`); no library needed, and it avoids a CSV dependency with quoting bugs |
| Password hashing | Spring Security `BCryptPasswordEncoder` (strength 10-12) | Matches existing behaviour, no `bcryptjs` equivalent needed |
| Logging | Logback + MDC (`runId`, `jobId`, `workspaceId`) with a **secret-masking converter** | The old project masked tokens/hashes/URIs in Pino; the same discipline is required, since `Rules.md`-equivalent policy forbids logging keys |
| Test | JUnit 5, Mockito, `@WebMvcTest`, AssertJ, `spring-security-test` | — |
| Build | Maven (multi-module) | Installed; 3.9.11 |

**Testing constraint from the environment:** Docker is not installed, so **Testcontainers is
unavailable**. Repository/integration tests must run against the native `MySQL96` service on a
disposable schema, gated by a property (e.g. `-Dintegration.db=true`) exactly as the old project
gated `RUN_DATABASE_TESTS`. Do not claim integration coverage that was skipped.

## B.2 AI service — FastAPI (Python)

| Concern | Choice | Why |
|---|---|---|
| Interpreter | **Python 3.12** (pinned, via `pyproject.toml requires-python = ">=3.12,<3.13"`) | The installed 3.14.6 is too new for reliable wheels (pydantic-core, numpy). 3.12 is the safest supported target. Must be installed — see `M-phase-plan.md` Phase 1 |
| PATH fix | Use the real interpreter, not the Windows Store alias | `…\WindowsApps\python.exe` currently shadows `…\Programs\Python\Python314\python.exe`, so bare `python` fails. Use `py -3.12` or a venv, and never rely on bare `python` in scripts |
| Web | **FastAPI** + `uvicorn` | Brief |
| Models | **Pydantic v2** | Requirement/Plan/Record contracts, JSON-Schema generation for Gemini `response_schema` |
| LLM client | **`google-genai`** SDK directly, using native **structured output** (`response_schema` = Pydantic model → JSON Schema) | Deliberate choice *against* `pydantic-ai`. Evidence: `agent-core-py` pins `pydantic-ai>=1.70.0` while the current release is `2.51.0` — a major-version jump inside the declared floor, i.e. an unstable API. Native Gemini structured output plus our own validation and one correction retry is fewer moving parts and reproduces the old project's proven pattern (`planner.service.ts:45-80`) |
| Provider abstraction | Thin internal `LlmClient` interface with a Gemini implementation | Keeps a future second provider possible without a silent default swap (the old `Rules.md:12` policy) |
| Web collection | **`firecrawl` Python SDK, pinned to an exact 4.x version** | Verified to expose `search`, `scrape`, `interact`, `browser`, `stop_interaction`, `map`, `crawl`, `parse`. Pin exactly — the TS core pinned a *beta* (`0.12.0-beta.2`), which we should not repeat |
| Async | `httpx` + `asyncio.gather` with a `Semaphore` for per-domain concurrency | The old Python reference ran sequentially inside an `async` function (`web_scraper_tool.py:8`); we do not repeat that |
| Blocking-call rule | Never call the sync Firecrawl SDK inside an `async def` | `agent-core-py/src/firecrawl_agent/agent.py:61,81` does exactly this and would stall the event loop |
| HTML→text | `trafilatura` (or Firecrawl markdown, preferred) | The reference used `BeautifulSoup.get_text()` which leaves `<script>`/`<style>` in "content" (`utils/web_scraper.py:47-50`) |
| Numeric similarity | `numpy` cosine over embeddings — **only if** we adopt embedding-based ranking | Default ranking is lexical (ported weights), which needs no embeddings and no extra API cost. See `H-ai-service-design.md` |
| Test | `pytest`, `pytest-asyncio`, `respx`/`unittest.mock` for Firecrawl and Gemini | Never call paid APIs in the default suite |
| Packaging | `pyproject.toml` + `uv` or `pip-tools` lockfile | Reproducible pins |

**No LangChain, no deepagents, no ChromaDB, no vector store.** The reference repo built an
ephemeral in-memory Chroma per request and discarded it after one `k=5` retrieval
(`tools/content_analyzer_tool.py:24-32`) — pure cost, no benefit.

## B.3 Frontend — Next.js

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 14.2.x, App Router, React 18.3, TypeScript strict** | Already working; preserving it is the brief's requirement. Do **not** combine a framework upgrade with the rewiring work — treat a Next 15 upgrade as a separate later phase if desired |
| Styling | **Tailwind CSS 3.4** + existing token set | The design system is the asset. Tokens are documented verbatim in `D-frontend-reuse-map.md` |
| Theme switching | add **`next-themes`** | The `.dark` palette already exists in `globals.css:45-72` but nothing ever adds the class — dark mode is currently unreachable |
| Server state | add **TanStack Query** | Replaces the bare `useState/useEffect` `use-api.ts` hook, which has no caching, no polling, no dedupe and no invalidation. Also gives a polling fallback when SSE drops |
| UI primitives | keep Radix + `class-variance-authority` + `clsx` + `tailwind-merge` | Already present and consistent |
| Animation | keep `framer-motion` | Used by the stage checklist / activity log |
| Icons | keep `lucide-react` + the 14 custom pirate SVG icons | Single icon set, per the design policy |
| Charts | **remove `recharts`** (declared but never imported) or wire it to real data | Dead dependency today |
| Fonts | Inter (sans), Cormorant Garamond (serif), JetBrains Mono (mono) | Exactly as shipped |
| API base URL | env-driven (`NEXT_PUBLIC_API_URL`) with a dev rewrite fallback | `next.config.js:15-22` currently hardcodes `http://localhost:4000` |
| Delete | `lib/export.ts` (dead client-side export builders) | Superseded by backend export jobs |

## B.4 Database

| Concern | Choice |
|---|---|
| Engine | **MySQL 8.4** as the supported baseline (brief: "MySQL 8+"); local dev runs the installed **9.6** service. `docker-compose.yml` must pin 8.4 to match, fixing the old drift where compose said 8.4 and dev ran 9.6 |
| Required features | JSON columns, generated + indexed columns, `SELECT … FOR UPDATE SKIP LOCKED` (8.0.1+), CTEs, window functions, `utf8mb4` |
| Charset / collation | `utf8mb4` / `utf8mb4_0900_ai_ci` |
| IDs | `CHAR(36)` UUID strings, application-generated (matches the existing model and keeps compound tenant FKs readable) |
| Migration tool | Flyway, versioned SQL under `db/migration` |
| Dynamic datasets | JSON `values` column + a registered `dataset_column` row per field, with **optional promoted generated columns** for hot filter fields. Never one fixed table per entity type |
| Full-text search | MySQL `FULLTEXT` index on a materialized searchable text column per row — **replaces** the old `LIKE '%…%'` over JSON (`dataset-query.repository.ts:732-741`) which cannot scale |

## B.5 Explicitly excluded

Redis, BullMQ, Celery, RQ, Kafka, RabbitMQ, Postgres, Prisma, Drizzle, Express, LangChain,
deepagents, `firecrawl-aisdk`, ChromaDB / any vector DB, Testcontainers (unavailable — no
Docker), and any code from `anakin-master` (AGPL-3.0) or `TheAgenticBrowser-main`
(Community License).

## B.6 License check on every new dependency

Per the constitution carried forward from the old `Rules.md:63`, each addition must be
MIT / BSD / Apache-2.0 / ISC / EPL. All choices above qualify: Spring Boot & POI & Hibernate
(Apache-2.0 / EPL / LGPL-2.1 for Hibernate ORM — acceptable as an unmodified library
dependency), Flyway (Apache-2.0 community edition), Bucket4j (Apache-2.0), Resilience4j
(Apache-2.0), commons-text (Apache-2.0), FastAPI / Pydantic / uvicorn (MIT), `google-genai`
(Apache-2.0), `firecrawl` SDK (MIT), `trafilatura` (Apache-2.0), TanStack Query (MIT),
next-themes (MIT), Tailwind (MIT).

**Hibernate ORM is LGPL-2.1.** That is fine for use as an unmodified dependency, but record it
as a conscious decision — the old project's constitution was strict about licenses.

Next: `C-repository-reuse-map.md`.
