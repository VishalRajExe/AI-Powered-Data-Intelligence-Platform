# FINALAIAGENT

AI-Powered Data Intelligence Platform — clean rebuild.

A user describes a data requirement in plain English; the system understands it, plans a
collection workflow, gathers data from permitted web sources, cleans and validates it, and
produces a source-traceable dataset that can be searched, filtered and exported.

**Status: Phase 5 complete — the run is curated before it collects.**
Requirement → search strategy → relevant sources → source policy (domains, robots.txt, duplicates,
relevance) → Firecrawl (`search` → `scrape` → `interact` when enabled) → structured records with
per-source citations and every refusal reported. One web engine, one LLM, no embedding provider.
Still nothing persisted: no schema, no dataset storage, no authentication.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router) · React 18 · TypeScript · Tailwind — PirateAgentUI design preserved |
| Backend | Java 21 · Spring Boot 3.5 · Spring Security · Spring Data JPA · Flyway |
| AI service | Python 3.12 · FastAPI · Gemini structured output · Firecrawl Python SDK |
| Database | MySQL 8.4+ |
| Async | MySQL-backed job table + Spring `ThreadPoolTaskExecutor` — **no Redis, no BullMQ** |

Three runtimes. No Node backend, no vendored TypeScript agent core, **one web engine**
(Firecrawl) and **one AI provider** (Gemini) — no embedding provider and no second search stack.

---

## Layout

```
FINALAIAGENT/
├── backend/       Spring Boot 3.5.16, Java 21 — orchestrator, system of record
├── ai-service/    FastAPI, Python — stateless AI + collection (no DB connection, no state)
├── frontend/      Next.js 14 — PirateAgentUI design foundation, real data only
├── database/      local MySQL container + connectivity probe. Owns NO schema.
├── deploy/        Dockerfiles and full-stack compose (unverified: no Docker here)
├── scripts/       bootstrap-env, dev-{backend,ai,frontend}, verify
├── docs/audit/    Phase 0 + 1.5 deliverables A–O
└── docs/control/  Memory.md, THIRD-PARTY.md
```

`.env` at the root is the single configuration source for all three services. `.env.example`
lists every name; `scripts/bootstrap-env.sh` creates a working copy and generates the secrets.

## Run it

```bash
cp .env.example .env                       # or: bash scripts/bootstrap-env.sh
bash scripts/dev-ai.sh                     # http://localhost:8000
bash scripts/dev-backend.sh                # http://localhost:8080
bash scripts/dev-frontend.sh               # http://localhost:3000
bash scripts/verify.sh                     # all suites, with counts
```

Each process starts independently. The frontend reaches the backend through a same-origin
rewrite, so the browser never learns a backend origin or credential.

The integrated research path, once both services are up:

```bash
cat > /tmp/research.json <<'JSON'
{
  "topic": "find remote frontend developer jobs in India",
  "extractionSchema": {
    "type": "object",
    "properties": {
      "jobs": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "company": {"type": "string"},
            "role": {"type": "string"},
            "application_url": {"type": "string"}
          },
          "required": ["company", "role", "application_url"],
          "additionalProperties": false
        }
      }
    },
    "required": ["jobs"],
    "additionalProperties": false
  },
  "limits": {"maxLoops": 5, "expectedRecords": 5}
}
JSON

curl -X POST localhost:8090/api/v1/research \
  -H 'Content-Type: application/json' --data @/tmp/research.json
```

Spring validates the contract, the Python graph plans → retrieves → extracts → critiques, and the
response carries `records`, `sources`, `metadata` and `validation`. Nothing is stored yet. The call
needs a working `GEMINI_API_KEY` and `FIRECRAWL_API_KEY`, because it makes real provider requests.

To see just the contract, before anything collects:

```bash
curl -X POST localhost:8090/api/v1/requirements/parse \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"find remote frontend jobs in India with salary"}'
```

The response is the parsed requirement plus the extraction schema derived from its own field list,
so two different prompts produce two different schemas. Spring validates that answer — a contract
the model itself is inconsistent about stops there with `INVALID_REQUIREMENT` and no collection run.

## Verified (Phases 2–5, executed 2026-09-29)

Every row is a command run in that session, with counts, not an assertion.

| Check | Result |
|---|---|
| `mvn test` | **80 passed**, 0 failures (54 through Phase 3, 68 through Phase 4, +12 at Phase 5) |
| `pytest` | **242 passed**, 8 gated live tests skipped by design (was 98 / 174; +68 cases at Phase 5) |
| `scripts/verify.sh` | backend tests ok, backend package ok, ai tests ok, frontend typecheck / lint / build ok |
| **Irrelevant sources** | ranked last and named in `Excluded from this search`; with `MIN_RELEVANCE_SCORE` set they are dropped with a reason and counted in `metadata.candidatesDropped`; with no floor nothing is dropped for vocabulary |
| **Blocked source** | refused by `SourcePolicy` before any fetch — `web.scrape_calls == []` is asserted — and reported in `validation.refusedSources` with the host and the rule that stopped it |
| **Duplicate source** | `?utm_source=`, `#fragment`, `www.`, default port and a trailing slash collapse to one page identity; a second search for the same page reports `duplicate-url`, `metadata.duplicateSourcesCollapsed` counts it, and a re-scrape is refused as already retrieved |
| **Retry** | 429/5xx/timeouts retried with capped jittered backoff inside `RetryPolicy` (a contract that existed since Phase 0 and had no reader); `404` and other permanent kinds stop after one attempt; `metadata.retriesAttempted` reports the cost; **browser sessions are never retried** |
| **robots restriction** | `Disallow` honoured for our own UA token; one file fetched per origin per run; 401/403/404 mean *no rules* while 5xx/unreachable follow `ROBOTS_ON_ERROR` — refused and reported by default |
| Refused robots ≠ silent permission | the reference implementation parsed a 500 error page as robots text and answered "allowed"; a test pins the corrected behaviour |
| Aggregation | sources in first-observed order with `citedByRecords` counts; a record citing a page no tool returned lands in `recordsWithoutEvidence` and `unverifiedUrls` and is **still returned**, never dropped |
| The planning turn sees retrieved material | 42+12 tests: **a Phase 2 porting defect found here** — the transcript reached only the submission prompt, so the model chose its next action blind |
| Java refuses an unusable curation request | `INVALID_CURATION_REQUEST` for a floor outside 0..1, a non-hostname "domain", a blank or absurd entity type (`SourceCurationPolicyTest`, 10 cases) |
| No new dependency | robots fetching is stdlib `urllib` on a worker thread; no embedding provider, no second search engine, nothing installed from the reference repo |
| Prompt → requirement → schema: three different requests, three distinct field sets | passed offline (`test_the_three_requests_yield_three_distinct_schemas`); **live confirmation blocked by free-tier quota**, see `docs/control/Memory.md` §2 |
| Spring rejects an inconsistent AI requirement and blocks collection | passed — `research` never called (`verify(..., never())`) |
| Needs-clarification returns without collecting | passed on both services |
| Research graph on doubles | all gates exercised: schema repair, repair exhaustion, loop bound on the search path, no-answer-before-data, critique rejection and re-loop, malformed verdict, unverified URL |
| Browser-session lifecycle against a **stub of the Firecrawl SDK client** | 19 tests: session created → prompt sent → `stop_interaction` in every path (success, SDK error, timeout), timeout returns a structured envelope with fallback advice, null fields stripped, empty lists preserved, truncation marked, non-http and empty-prompt refused **before** a session exists |
| `interact` gating | refused when not in the run's tool set, when the engine has no sessions, when the URL was never retrieved, outside the domain policy, and in parallel batch execution |
| Per-run action schema | generated from the enabled tools — a disabled tool is not in the enum, so the provider cannot request it; asserted on the recorded LLM call |
| Tool ceiling | a request naming `interact` while the service excludes it → **400 `NO_PERMITTED_WEB_TOOLS`**; Java rejects unknown names, empty lists, out-of-range budgets (11 `WebToolPolicyTest` cases) |
| SKILL.md loader | 24 tests: frontmatter subset parsing, validation reporting, discovery, domain match (exact / `www.` / suffix), traversal guard refuses `../` and absolute paths |
| Backend jar boots; `/api/v1/health` → 200 | passed (note: 8080 is held on this machine by the **old project's** jar; use `SERVER_PORT=8090`) |
| Backend with no credentials → **exit 1**, naming `AI_SERVICE_API_KEY`, `MYSQL_PASSWORD`, `MYSQL_USER` | passed |
| AI service with a missing provider key → **exit 1**, naming the variable | passed |
| Live `POST /api/v1/research` through Spring → Python, invalid for Python | **422 `AI_SERVICE_REJECTED_REQUEST`** carrying Python's own envelope |
| Same request with an empty schema | **400 `INVALID_EXTRACTION_SCHEMA`**, and `verifyNoInteractions` proves Python was never called |
| Java ↔ Python wire contract | camelCase round-trip test on a captured Python payload shape, now including `allowedTools`, `maxInteractionsPerRun`, `interactionsUsed`, `enabledTools`, `playbooksUsed` |
| `npm run typecheck` / `lint` / `build` | passed; 13 pages |
| Browser → Next → Spring → FastAPI health chain | passed (`aiService: UP`) |
| Actuator liveness stays `UP` while MySQL is down | passed |
| Real MySQL round-trip (`/ready` → 200) | **not achieved** — still needs a matching database user |
| **Real Firecrawl execution** | **not performed.** `FIRECRAWL_API_KEY` has length 0 in both the shell and the root `.env`; `tests/test_live_firecrawl.py` skips all four cases and prints the reason. Gated behind `RUN_LIVE_FIRECRAWL_TESTS=true` |
| Live Gemini research run | **not performed** — a call would bill a free-tier key already at its 20 requests/day ceiling. Gated behind `RUN_LIVE_PROVIDER_TESTS=true` |

## Deliberately deferred out of Phase 1

The written plan (`docs/audit/M-phase-plan.md`) put the 21-table Flyway schema, JWT auth and
internal API-key *issuance* in this phase. Per instruction, Phase 1 is foundation only, so
Flyway, JPA entities and Spring Security arrive with the schema and authentication phases. The
internal `X-API-Key` boundary **is** implemented, because it is what proves the two services can
be wired without inventing business logic.

---

## Documentation

### Phase 0 audit — `docs/audit/`

Read `00-FORENSIC-AUDIT.md` first; it explains what was found in the old project and the four
reference repositories, including the root cause of the hardcoded-schema defect.

| File | Contents |
|---|---|
| [`00-FORENSIC-AUDIT.md`](docs/audit/00-FORENSIC-AUDIT.md) | Findings: root cause of hardcoded demo behaviour, broken/unrunnable paths, doc-vs-code contradictions, licensing constraints, environment reality check |
| [`A-final-architecture.md`](docs/audit/A-final-architecture.md) | The integration-boundary decision, responsibility split, request flow, deployment topology |
| [`B-technology-stack.md`](docs/audit/B-technology-stack.md) | Every library choice with its justification |
| [`C-repository-reuse-map.md`](docs/audit/C-repository-reuse-map.md) | Reuse matrix for all five codebases: repository → useful feature → source path → actual implementation → reuse method → destination |
| [`D-frontend-reuse-map.md`](docs/audit/D-frontend-reuse-map.md) | Design tokens (authoritative), component inventory, fabrication to remove |
| [`E-database-model.md`](docs/audit/E-database-model.md) | 21-table MySQL model, enums, indexes, migration plan |
| [`F-workflow-model.md`](docs/audit/F-workflow-model.md) | Dynamic planning, step vocabulary, four worked examples, integrity gates |
| [`G-api-map.md`](docs/audit/G-api-map.md) | Public API, internal AI API, SSE contract, screen mapping |
| [`H-ai-service-design.md`](docs/audit/H-ai-service-design.md) | FastAPI service: contracts, prompts, validation/repair, quality pipeline |
| [`I-firecrawl-integration.md`](docs/audit/I-firecrawl-integration.md) | The Firecrawl decision with evidence, cost controls, documented fallback |
| [`J-no-redis-job-architecture.md`](docs/audit/J-no-redis-job-architecture.md) | The four Redis replacements, claim/lease SQL, retry, shutdown |
| [`K-environment-variables.md`](docs/audit/K-environment-variables.md) | Every variable, what was removed, `.env.example` |
| [`L-risks.md`](docs/audit/L-risks.md) | 27 risks with severity, likelihood and mitigation |
| [`M-phase-plan.md`](docs/audit/M-phase-plan.md) | Phases 0-16 with exit criteria |
| [`N-scripts-and-dependencies.md`](docs/audit/N-scripts-and-dependencies.md) | Old-project toolchain forensics: broken workspace links, measured vs claimed quality, orphan scripts, dependency findings |
| [`O-new-repositories-integration-analysis.md`](docs/audit/O-new-repositories-integration-analysis.md) | Phase 1.5: the two new data-enrichment repositories — licence rulings, what they really solve, critique-gate adoption, and why Bright Data / Tavily are rejected |

### Project control — `docs/control/`

`Memory.md` records verified state and decisions. Per the discipline rule, each phase reads it,
implements only that phase, then updates it.

`PRD.md`, `Rules.md` and `Phases.md` were planned for Phase 1 but **deferred to Phase 2**: writing
them is a documentation task, and Phase 1's exit condition was three processes that start — and
fail honestly — without business logic. The old `Architecture.md` and `Design.md` are **not**
carried forward — both are stale and contradict what was actually built. See `C` §C.1.6 for what
is kept, adapted or dropped.

---

## Key decisions recorded in Phase 0

1. **Three runtimes.** Firecrawl's Python SDK natively exposes `search`, `scrape` and
   `interact`, so FastAPI drives collection directly. No fourth (Node) runtime, and no vendoring
   of the 5,035-LOC TypeScript agent core. We port its **schema-validation gate**, its
   **"no answer before data" gate**, and its **prompt policy** — the parts that actually prevent
   fabrication.
2. **Spring owns orchestration; Python is stateless.** The LLM decides *what* to collect, Java
   decides *whether and when* it runs, Python decides *how*. One orchestrator, one source of
   truth for step state.
3. **Governance moved outward.** Python receives only URLs Java has already cleared, so the
   source policy cannot be bypassed from inside the agent.
4. **No demo mode, no silent fallbacks.** A missing credential is a startup failure. This inverts
   the old project's behaviour, which substituted hardcoded demo data whenever a key was absent.
5. **Single node for v1.** Removing Redis makes SSE fan-out and per-domain rate limiting
   in-process. Documented as a constraint, with the claim query written for future scale-out.
6. **No code from `anakin-master` (AGPL-3.0) or `TheAgenticBrowser-main` (Community License).**
   Patterns studied and independently reimplemented; the reuse map marks every such item
   `PORT (concept only)`.

## Open gates

- **G1 — demonstration strategy** with demo mode removed (`L` R8, `M` Phase 0). Still undecided.
- **G2 — is Firecrawl's live `interact` sufficient?** Narrowed at Phase 4, not closed: the whole
  session lifecycle is implemented and the Python SDK's shape is verified by introspection, so no
  sidecar is needed for API-shape reasons. Whether a live prompt-mode session completes inside a
  sane deadline and returns usable text is unmeasured, because there is no `FIRECRAWL_API_KEY`.
- **S1 — site playbooks.** The loader works and is tested; the platform ships **zero** `SKILL.md`
  playbooks, and upstream's were not copied. Writing our own means observing real sites, which
  needs the key above. `ai-service/skills/README.md` documents the format and the rules.
- **Q1 — is lexical relevance good enough?** `app/curation/relevance.py` counts requested
  vocabulary in a title, snippet and URL path, saturating at four matched terms. The reference repo
  used embedding cosine similarity; adding an embedding provider purely for ranking was declined.
  Judge against live result sets, then decide between keeping it, setting `MIN_RELEVANCE_SCORE`, or
  adding one Gemini rerank over the ~8 ranked candidates.
- **Q2 — should an unreadable robots.txt keep refusing the source?** `ROBOTS_ON_ERROR=restrict` is
  the default and refuses rather than fetches blind; the cost (a host with a flaky robots endpoint
  yields no data) is unmeasured because no robots fetch has ever run here. Refusals are reported in
  `validation.refusedSources` either way.
- **A MySQL user the app can actually connect as.** Phase 1 verified configuration binding and
  the probe reaching the server, but `/ready` cannot return 200 until `MYSQL_USER`/`MYSQL_PASSWORD`
  match a real account with `finalagent_dev` granted.
- **Python 3.12** remains the pinned deployment interpreter; Phase 1 was built and tested on the
  3.14.6 that is installed, with provider SDKs held out of the base install.
- **Docker is unavailable**, so nothing in `deploy/` has been built.

---

## Reference material (outside this project, read-only)

| Path | License | Use |
|---|---|---|
| `../AI-Powerd Data Intelligence` | proprietary | Primary reference: schema, contracts, quality pipeline, governance, UI design |
| `../web-agent-main` | MIT | Firecrawl agent core: gates, prompts, toolkit discipline |
| `../web-research-agent-master` | MIT (LICENSE present) | Ranking/robots/retry/aggregation shapes, taken at Phase 5 with the mechanism changed (`docs/audit/C-repository-reuse-map.md` §C.3.1). Its Google CSE search and Azure embeddings were declined |
| `../TheAgenticBrowser-main` | Community License — **no copying** | Critique/verification pattern only |
| `../anakin-master` | AGPL-3.0 — **no copying** | Job lifecycle patterns only |
| `../data-enrichment-js-main` | **MIT declared in `package.json` only — no licence text present** | Critique-gate pattern, graph bounds discipline (see `O`) |
| `../ai-data-enrichment-agent-main` | **No licence anywhere — default copyright reserved** | Read-only reference; contributes no capability we lack (see `O`) |

Nothing in this project depends on those repositories at build or runtime.
