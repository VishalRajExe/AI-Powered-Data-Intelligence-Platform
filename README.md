# FINALAIAGENT

AI-Powered Data Intelligence Platform — clean rebuild.

A user describes a data requirement in plain English; the system understands it, plans a
collection workflow, gathers data from permitted web sources, cleans and validates it, and
produces a source-traceable dataset that can be searched, filtered and exported.

**Status: Phase 0 complete — forensic audit only. No application code exists yet.**

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

## Documentation

### Phase 0 audit — `docs/audit/`

Read `00-FORENSIC-AUDIT.md` first; it explains what was found in the old project and the four
reference repositories, including the root cause of the hardcoded-schema defect.

| File | Contents |
|---|---|
| [`00-FORENSIC-AUDIT.md`](docs/audit/00-FORENSIC-AUDIT.md) | Findings: root cause of hardcoded demo behaviour, broken/unrunnable paths, doc-vs-code contradictions, licensing constraints, environment reality check |
| [`A-final-architecture.md`](docs/audit/A-final-architecture.md) | The integration-boundary decision, responsibility split, request flow, deployment topology |
| [`B-technology-stack.md`](docs/audit/B-technology-stack.md) | Every library choice with its justification |
| [`C-repository-reuse-map.md`](docs/audit/C-repository-reuse-map.md) | Source path → logic → target location → method, for all five codebases |
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

### Project control — `docs/control/`

`Memory.md` records verified state and decisions. Per the discipline rule, each phase reads it,
implements only that phase, then updates it.

`PRD.md`, `Rules.md`, `Phases.md` and the design reference are created in Phase 1, adapted from
the old project's control docs (see `C` §C.1.6 for what is kept, adapted or dropped). The old
`Architecture.md` and `Design.md` are **not** carried forward — both are stale and contradict
what was actually built.

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

## Open decisions before Phase 1

- **G1 — demonstration strategy** with demo mode removed (`L` R8, `M` Phase 0).
- **G2 — confirm Firecrawl Python `interact` is sufficient** (resolved by the Phase 2 spike).
- Install **Python 3.12**; note **Docker is unavailable**, so integration tests run against the
  native MySQL 9.6 service.

---

## Reference material (outside this project, read-only)

| Path | License | Use |
|---|---|---|
| `../AI-Powerd Data Intelligence` | proprietary | Primary reference: schema, contracts, quality pipeline, governance, UI design |
| `../web-agent-main` | MIT | Firecrawl agent core: gates, prompts, toolkit discipline |
| `../web-research-agent-master` | MIT | Prompts, ranking algorithm, retry formula |
| `../TheAgenticBrowser-main` | Community License — **no copying** | Critique/verification pattern only |
| `../anakin-master` | AGPL-3.0 — **no copying** | Job lifecycle patterns only |

Nothing in this project depends on those repositories at build or runtime.
