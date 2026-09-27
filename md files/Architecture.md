# Architecture.md — Technical Architecture
### Project: Scoutly

> This file defines **HOW** the product described in `PRD.md` is technically built: system flow, stack, APIs, database schema, external services, and the exact folder structure. Constraints/allowed tools live in `Rules.md`, not here. Build order lives in `Phases.md`, not here.

---

## 1. High-Level System Flow

```
                              USER (browser)
                                   │
                                   ▼
                         Next.js Dashboard (Frontend)
                                   │  (REST + SSE/websocket)
                                   ▼
                          Next.js API Routes (Backend)
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                     ▼
     Requirement Parser    Workflow Orchestrator     Dataset API
     (LLM: prompt → data      (firecrawl/web-agent      (CRUD, search,
      contract JSON)           Deep Agents core)         filter, export)
                                   │
                     ┌─────────────┼─────────────┐
                     ▼             ▼             ▼
                  Search        Scrape        Interact
                 (Firecrawl)   (Firecrawl)   (browser automation)
                     │             │             │
                     └─────────────┼─────────────┘
                                   ▼
                       Structured Extraction (JSON)
                                   │
                                   ▼
                     Data Intelligence Engine (ours)
                     ┌─────────────────────────────┐
                     │ Normalize → Validate →       │
                     │ Deduplicate → Entity-resolve │
                     │ → Confidence scoring         │
                     └─────────────┬───────────────┘
                                   ▼
                                  MySQL
                     (workflows, runs, datasets,
                      dataset_rows, sources, exports)
                                   │
                                   ▼
                        Dashboard reads back via API
                (Task Monitor · Dataset Explorer · History · Export)
```

## 2. Technical Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js (App Router) + React + TypeScript | Scaffolded from `firecrawl create agent -t next` |
| Styling/UI | Tailwind CSS + shadcn/ui | See `Design.md` for tokens |
| Agent Core | `firecrawl/web-agent` (Deep Agents / LangChain harness) | Plan-act-observe loop, skills, parallel subagents |
| Web Tools | Firecrawl (`firecrawl-aisdk`): Search, Scrape, Interact | Self-hosted Firecrawl instance or hosted API key |
| LLM Provider | Anthropic Claude (primary) | Used for requirement parsing, planning, and agent reasoning |
| Backend API | Next.js API Routes (or a separate Node/Express service if the agent needs a long-running process) | REST + Server-Sent Events for live workflow status |
| Database | MySQL | Source of truth for all persistent product data (not the agent's ephemeral reasoning state) |
| ORM | Prisma or Drizzle | Type-safe schema + migrations |
| Auth | NextAuth.js (or Clerk) | Multi-tenant, per-user data isolation |
| Job/Queue | BullMQ + Redis (or a simple DB-backed job table for v1) | Tracks async workflow runs, retries |
| File Export | `papaparse`/native (CSV), native `JSON.stringify` (JSON), `SheetJS`/`exceljs` (Excel) | Server-generated download files |
| Dedup Engine | Custom normalization + fuzzy matching (e.g. Levenshtein/Jaro-Winkler via a small library) | See `Rules.md` for allowed libraries |
| Hosting | Vercel (frontend/API) + a persistent MySQL (PlanetScale/Aiven/RDS) + self-hosted Firecrawl (Docker) | |

## 3. Core Data Flow (Step by Step)

1. **Prompt intake** — user submits free text via the dashboard.
2. **Requirement Parser** — an LLM call converts the prompt into a strict JSON **Data Contract**:
   ```json
   {
     "entity": "startup",
     "fields": ["company_name", "founder", "website", "funding", "linkedin"],
     "filters": { "country": "India", "founded_after": 2020 },
     "target_count": 300
   }
   ```
3. **Workflow creation** — a `workflows` row is created; the Data Contract is handed to the `firecrawl/web-agent` orchestrator as its task input.
4. **Agent execution** — the Deep Agents loop plans steps (discover sources → search → scrape/interact → extract), spawning parallel subagents per target (e.g., one per company/source cluster). Each tool call and result is streamed back and persisted as a `workflow_step`.
5. **Structured extraction** — each subagent returns structured JSON matching the Data Contract's field list, plus the source URL(s) it used.
6. **Data Intelligence Engine (ours)** — raw extracted records pass through:
   - **Normalize** — casing, date/currency/phone/URL formatting
   - **Validate** — type/format checks against the Data Contract
   - **Deduplicate** — exact + fuzzy match on key fields
   - **Entity resolution** — merge near-duplicate entities into one record with combined sources
   - **Confidence scoring** — based on number/agreement of corroborating sources
7. **Persistence** — cleaned records are written to `dataset_rows`, linked to `sources` and the parent `datasets` row.
8. **Dashboard read** — the frontend polls/subscribes to workflow status (SSE) while running, then queries the Dataset API for search/filter/export once complete.

## 4. API Surface (v1)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/workflows` | POST | Submit a new NL prompt → creates workflow + triggers agent |
| `/api/workflows` | GET | List all workflows (history) for current user |
| `/api/workflows/:id` | GET | Get workflow detail + step history |
| `/api/workflows/:id/stream` | GET (SSE) | Live status stream of a running workflow |
| `/api/workflows/:id/rerun` | POST | Re-run or duplicate a past workflow |
| `/api/datasets` | GET | List datasets for current user |
| `/api/datasets/:id` | GET | Get dataset metadata |
| `/api/datasets/:id/rows` | GET | Paginated, filterable, searchable rows |
| `/api/datasets/:id/rows/:rowId/sources` | GET | Source evidence for one row |
| `/api/datasets/:id/export?format=csv|json|xlsx` | GET | Export dataset (optionally filtered) |
| `/api/auth/*` | — | Auth provider routes |

## 5. Database Schema (MySQL)

```
users
  id, email, name, created_at

workflows
  id, user_id (FK), prompt_raw, data_contract (json),
  status (pending|planning|running|completed|failed),
  created_at, updated_at

workflow_steps
  id, workflow_id (FK), step_type (plan|search|scrape|interact|extract|clean|validate|dedupe),
  status (pending|running|done|error), detail (json), started_at, ended_at

datasets
  id, workflow_id (FK), user_id (FK), name, description,
  record_count, source_count, status, created_at, updated_at

dataset_rows
  id, dataset_id (FK), data (json),           -- dynamic fields per Data Contract
  confidence_score, is_duplicate_of (nullable FK -> dataset_rows.id),
  collected_at

sources
  id, dataset_row_id (FK), url, title, retrieved_at,
  raw_snippet, screenshot_url (nullable)

exports
  id, dataset_id (FK), user_id (FK), format (csv|json|xlsx),
  filter_applied (json), file_url, created_at
```

Notes:
- `dataset_rows.data` is `json` because the field schema is dynamic per Data Contract (different entity types have different fields). Common filterable fields can optionally be promoted to indexed generated columns later for performance.
- `sources` is one-to-many per row because a single field/record can be corroborated by multiple pages.

## 6. External Services

| Service | Purpose |
|---|---|
| Firecrawl (self-hosted or hosted API) | Search / Scrape / Interact primitives |
| Anthropic Claude API | Requirement parsing + agent reasoning |
| MySQL provider (PlanetScale/Aiven/RDS) | Primary datastore |
| Redis (optional, for job queue) | Async workflow run tracking |
| Auth provider (NextAuth/Clerk) | Authentication |
| Object storage (S3-compatible, optional) | Export file storage, source screenshots |

## 7. Folder / File Structure

```
scoutly/
├── apps/
│   └── web/                          # Next.js app (dashboard + API routes)
│       ├── app/
│       │   ├── (auth)/               # login/signup routes
│       │   ├── dashboard/
│       │   │   ├── workflows/        # new task, live monitor, history
│       │   │   ├── datasets/         # dataset explorer, row detail, export
│       │   │   └── layout.tsx
│       │   ├── api/
│       │   │   ├── workflows/
│       │   │   ├── datasets/
│       │   │   └── auth/
│       │   └── layout.tsx
│       ├── components/
│       │   ├── ui/                   # shadcn primitives
│       │   ├── workflow/             # live progress, step timeline
│       │   └── dataset/              # table, filters, export menu, source drawer
│       └── lib/
│           ├── db/                   # Prisma/Drizzle client + queries
│           └── api-client.ts
│
├── packages/
│   ├── agent-core/                   # forked/wrapped firecrawl/web-agent
│   │   ├── skills/                   # SKILL.md playbooks per entity type
│   │   ├── orchestrator.ts
│   │   └── tools/                    # search/scrape/interact bindings
│   ├── requirement-parser/           # prompt → Data Contract LLM logic
│   ├── data-engine/                  # normalize, validate, dedupe, entity-resolve, confidence
│   └── db-schema/                    # Prisma/Drizzle schema + migrations
│
├── PRD.md
├── Architecture.md
├── Rules.md
├── Phases.md
├── Design.md
└── Memory.md
```

## 8. Authentication & Multi-Tenancy

- Every `workflow` and `dataset` row is scoped to a `user_id`.
- All API routes must verify session ownership before returning or mutating a resource.
- No cross-user data visibility in v1 (see `PRD.md` §8 Out of Scope — sharing is a future feature).

## 9. Workflow Execution Model

- Each user-submitted prompt creates exactly one `workflow`.
- A workflow is executed by a single agent orchestration run, which may internally spawn many parallel subagents (one per independent target such as a company or source cluster).
- Execution status is persisted incrementally (`workflow_steps`) so that closing the browser mid-run doesn't lose progress — reopening the workflow page resumes reading from the DB/stream.
- On completion (success or partial failure), a `dataset` is created/updated from whatever valid records were produced; partial results are always preserved rather than discarded on error.
