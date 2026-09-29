# FINALAIAGENT

AI-Powered Data Intelligence Platform — clean rebuild.

A user describes a data requirement in plain English; the system understands it, plans a
collection workflow, gathers data from permitted web sources, cleans and validates it, and
produces a source-traceable dataset that can be searched, filtered and exported.

**Status: Phase 1 complete — three runnable processes and one database. No business
functionality yet.** The application layers start, refuse to start without credentials, and talk
to each other; nothing collects, plans, or exports.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router) · React 18 · TypeScript · Tailwind — PirateAgentUI design preserved |
| Backend | Java 21 · Spring Boot 3.5 · Spring Security · Spring Data JPA · Flyway |
| AI service | Python 3.12 · FastAPI · Gemini structured output · Firecrawl Python SDK |
| Database | MySQL 8.4+ |
| Async | MySQL-backed job table + Spring `ThreadPoolTaskExecutor` — **no Redis, no BullMQ** |

Three runtimes. No Node backend, no vendored TypeScript agent core.

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
├── docs/audit/    Phase 0 deliverables A–N
└── docs/control/  Memory.md
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

## Verified (Phase 1, executed 2026-09-29)

| Check | Result |
|---|---|
| `mvn test` | **27 passed**, 0 failures |
| Backend jar boots; `/api/v1/health` → 200 | passed |
| Backend with no credentials → **exit 1**, naming `AI_SERVICE_API_KEY`, `MYSQL_PASSWORD`, `MYSQL_USER` | passed |
| `pytest` | **31 passed** |
| AI service boots; `/ai/v1/ready` without key → 401, with key → 200 | passed |
| AI service with a missing provider key → **exit 1**, naming the variable | passed |
| `npm run typecheck` / `lint` / `build` | passed; 13 pages generated |
| Browser → Next → Spring → FastAPI, full chain on one `curl` | passed (`aiService: UP`) |
| Actuator liveness stays `UP` while MySQL is down | passed |
| Real MySQL round-trip (`/ready` → 200) | **not achieved** — needs credentials for a matching database user |

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

## Open items before Phase 2

- **G1 — demonstration strategy** with demo mode removed (`L` R8, `M` Phase 0). Still undecided.
- **G2 — confirm Firecrawl Python `interact` is sufficient** (resolved by the Phase 2 spike).
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
| `../web-research-agent-master` | MIT | Prompts, ranking algorithm, retry formula |
| `../TheAgenticBrowser-main` | Community License — **no copying** | Critique/verification pattern only |
| `../anakin-master` | AGPL-3.0 — **no copying** | Job lifecycle patterns only |
| `../data-enrichment-js-main` | **MIT declared in `package.json` only — no licence text present** | Critique-gate pattern, graph bounds discipline (see `O`) |
| `../ai-data-enrichment-agent-main` | **No licence anywhere — default copyright reserved** | Read-only reference; contributes no capability we lack (see `O`) |

Nothing in this project depends on those repositories at build or runtime.
