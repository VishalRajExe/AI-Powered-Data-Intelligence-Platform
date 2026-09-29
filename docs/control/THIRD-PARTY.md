# THIRD-PARTY.md — provenance of ported and adapted logic

Every external implementation FINALAIAGENT draws on, what was taken, where it landed, and the
licence position. Required by `docs/audit/C-repository-reuse-map.md` §C.2 and the licensing rule
inherited from the old project's `Rules.md` §2.

**Nothing here is a runtime dependency on a reference repository.** Each reference repo's code is
not installed, not imported, and not vendored; ports are re-expressed in this project's own
services. `FINALAIAGENT` builds and runs without any of them present.

| # | Upstream | Version / date read | Declared licence | What we took | Destination | Method | Local delta |
|---|---|---|---|---|---|---|---|
| 1 | `data-enrichment-js-main` (LangGraph research template; author "William Fu-Hinthorn"; README template-lock identifies `langchain-ai/data-enrichment-js`) | snapshot `data-enrichment-js-main`, read 2026-09-29; `package.json:6` version `0.0.1`, `private: true` | **MIT declared at `package.json:7` only — no LICENSE file, no copyright/SPDX text anywhere in the tree** | Graph topology and node semantics (`graph.ts:43-109,155-225,234-291`), state shape (`state.ts`), configurable bounds (`configuration.ts:59-61`), prompt structure (`prompts.ts`), schema-as-forced-output device | `ai-service/app/research/{graph,tools,state,prompts}.py`, `ai-service/app/research/prompts/*.md` | **PORT** — behaviour re-implemented in Python; no line translated from TypeScript | Search became `firecrawl.search`; the `fetch`+`slice(0,50000)`+LLM-notes scraper became `firecrawl.scrape`; Tavily dropped; bound enforced on every path; exhaustion now `FAILED`; `improvement_instructions` required on rejection; provenance and per-record source attachment added; `maxInfoToolCalls` (declared, never read) dropped; `__state` argument injection dropped; prompt substitution no longer vulnerable to `$&`/`$1` |
| 2 | `web-agent-main/agent-core` (Firecrawl Agent Core) | `agent-core/package.json` version lineage, vendored copy `0.1.0-vendor.1`, read 2026-09-29 | **MIT declared at `agent-core/package.json:118`; upstream ships no LICENSE file** | `schema-validate.ts` — one validator backing prompt checklist, runtime gate and post-run assessment; the two anti-fabrication gates at `agent.ts:37-40,42-66,76,97-118` | `ai-service/app/extraction/schema_validate.py`; gates 1 and 2 in `ai-service/app/research/graph.py` | **PORT** | Walks real **JSON Schema** (`type`/`properties`/`required`/`items`) rather than upstream's example-shaped object, because our planner emits JSON Schema; empty array now reported missing (upstream parity, restored after a test caught our omission); extra-key paths reported at every depth |
| 3 | `web-research-agent-master` | read 2026-09-29, `LICENSE:1-3` MIT © 2025 Dev Dalia | **MIT (LICENSE file present)** | Query-analysis and conflict/citation prompt ideas; retry backoff formula; chunking defaults | prompts and `backend/.../governance/RetryPolicy.java` (source-governance phase) | **PORT / ADAPT** | Nothing executed yet; recorded for the governance phase |
| 4 | `TheAgenticBrowser-main` | read 2026-09-29 | **TheAgentic Community License v1.0** — §1.1 excludes providing a competing online service | Patterns only: plan→act→critique→replan, `{feedback, terminate, final_response}` verdict shape, termination thresholds | `ai-service/app/research/graph.py` critique verdict type; verify phase | **PORT (concept only)** | Zero lines copied or translated. Independent implementation from a behavioural description |
| 5 | `anakin-master` | read 2026-09-29, `NOTICE:1-4` | **AGPL-3.0** | Patterns only: job lifecycle, `persistCtx` fresh-context terminal writes, batch parent/child rollup, handler chain, pool backpressure | `backend/.../engine/` (job engine phase) | **PORT (concept only)** | Zero lines copied. Also supplied the negative findings: no durable claim mechanism, no recovery, dead `MAX_JOB_RETRIES` |
| 6 | `ai-data-enrichment-agent-main` | read 2026-09-29; `requirements.txt` unpinned | **No licence of any kind** | Nothing. Its `topic + schema` entry shape and `submit_info` termination idea were already present in stronger form elsewhere | — | **NO TAKE** | Not copied, not translated, not depended on. Its Bright Data engine is rejected on governance grounds (`O` §O.5) |

## Runtime third-party dependencies

Standard open-source packages installed from registries, not from the reference repositories.
Licences are as declared by the packages; none is AGPL or copyleft.

| Package | Where | Purpose |
|---|---|---|
| Spring Boot 3.5.16 (framework; Hibernate ORM is LGPL-2.1, used unmodified) | `backend/pom.xml` | web, validation, actuator, JDBC |
| `com.mysql:mysql-connector-j` (GPL with FOSS exception) | `backend/pom.xml` runtime | MySQL driver |
| FastAPI, Starlette, Pydantic v2, pydantic-settings, python-dotenv | `ai-service/pyproject.toml` | HTTP service and contracts |
| `uvicorn` | same | ASGI server |
| `google-genai` 1.75.0 | `collection` extra | Gemini structured output |
| `firecrawl` 4.45.0 (exact pin) | `collection` extra | sole web engine |
| Next.js 14.2.35, React 18, Tailwind, Radix primitives, lucide-react | `frontend/package.json` | UI |

`firecrawl-aisdk@0.12.0-beta.2`, the beta pin that `web-agent-main` depends on, is **not** used: we
call the Firecrawl Python SDK directly. See `docs/audit/I-firecrawl-integration.md`.

## Open question that must not be resolved silently

The user's master instruction asks for `data-enrichment-js-main` to be "copied/merged" into this
project. Item 1 above is a behavioural port into a different language, which is the position this
file records — but the upstream licence exists only as a `package.json` field, with no licence text
in the tree. Before any release, either confirm the upstream terms or treat item 1 as concept-only.
Tracked as gate **L1** in `docs/control/Memory.md`, and as risks R28/R29 in `docs/audit/L-risks.md`.
