# Phases.md — Build Order
### Project: Scoutly

> This file defines **WHEN**/in what order the system gets built. The AI must complete a phase's completion criteria before starting the next phase, and should not attempt to build multiple phases simultaneously. Each phase should leave the project in a runnable, demoable state.

---

## Phase 0 — Foundation & Setup
**Goal:** A running skeleton with no real features yet.
- Scaffold the Next.js app via `firecrawl create agent -t next`.
- Set up TypeScript strict mode, Tailwind, shadcn/ui.
- Set up MySQL + chosen ORM (Prisma or Drizzle) with an empty schema migration pipeline.
- Set up environment variable structure (`.env.example`) for Firecrawl, Anthropic, DB, Auth.
- Set up repo folder structure exactly as defined in `Architecture.md` §7.
**Completion criteria:** App boots locally, connects to the DB, and renders a placeholder dashboard page. No agent logic yet.

## Phase 1 — Authentication
**Goal:** Every subsequent feature can be scoped to a logged-in user.
- Integrate auth provider (NextAuth.js or Clerk).
- Create `users` table/model.
- Protect all `/dashboard/*` and `/api/*` routes behind a session check.
**Completion criteria:** A user can sign up, log in, log out, and reach an empty authenticated dashboard shell. No user can access another user's (nonexistent yet) data.

## Phase 2 — Prompt Understanding (Requirement Parser)
**Goal:** Convert a free-text prompt into a structured Data Contract.
- Build the `requirement-parser` package: an LLM call with a strict system prompt that outputs the Data Contract JSON (entity, fields, filters, target_count).
- Add a clarifying-question fallback path for ambiguous prompts (per `PRD.md` FR-3).
- Build a minimal UI: a text box that submits a prompt and displays the parsed Data Contract (debug view only, not yet the final UI).
**Completion criteria:** Given 10 varied sample prompts, the parser reliably produces a valid, schema-conformant Data Contract for at least 8/10, and asks a sane clarifying question for the rest.

## Phase 3 — Workflow Planner & Agent Core Integration
**Goal:** Wire the Data Contract into `firecrawl/web-agent`'s Deep Agents orchestrator.
- Integrate `agent-core` package wrapping the forked `firecrawl/web-agent`.
- Create the `workflows` and `workflow_steps` tables.
- On prompt submission: create a `workflow` row, hand the Data Contract to the agent as its task input, and persist each step/tool call as it happens.
**Completion criteria:** Submitting a prompt creates a workflow row, triggers a real agent run, and every planning/tool-call step is visible in the database as it happens (even if the UI to view it isn't built yet).

## Phase 4 — Search & Source Discovery Engine
**Goal:** The agent can reliably find candidate sources for a given data contract.
- Confirm/tune the agent's Search tool usage and skill definitions for source discovery.
- Implement the source-governance check from `Rules.md` §2 (robots.txt / ToS gate) before any scrape/interact call proceeds.
- Log every considered source (accepted or skipped-with-reason) to `workflow_steps`.
**Completion criteria:** For a sample data contract, the agent discovers a reasonable list of candidate sources and correctly skips at least one deliberately-disallowed test source, logging why.

## Phase 5 — Scraping / Extraction Engine
**Goal:** Turn discovered sources into structured raw records.
- Wire Scrape/Interact tools and confirm structured JSON output matches the Data Contract's field list.
- Enable parallel subagent fan-out for independent targets.
- Persist raw extraction output (pre-cleaning) with its source URL(s).
**Completion criteria:** Running a sample workflow end-to-end produces a set of raw JSON records, each with at least one attached source URL, written to a staging table or field.

## Phase 6 — Cleaning, Validation & Deduplication (Data Intelligence Engine)
**Goal:** Raw records become a trustworthy dataset.
- Build the `data-engine` package: normalization (dates, currency, phone, URL, casing), field-type validation, fuzzy deduplication, entity resolution, confidence scoring.
- Wire this engine as the final step before writing to `dataset_rows`.
**Completion criteria:** Feeding the engine a raw batch containing deliberate duplicates (e.g., "OpenAI" / "Open AI Inc.") and malformed fields produces a cleaned batch with duplicates merged, invalid fields flagged, and confidence scores populated.

## Phase 7 — Database & Dataset Persistence Layer
**Goal:** Full persistence of the product's data model.
- Implement all remaining tables from `Architecture.md` §5: `datasets`, `dataset_rows`, `sources`, `exports`.
- Implement the Dataset API endpoints (`/api/datasets`, `/api/datasets/:id/rows`, etc.).
**Completion criteria:** After a full workflow run, a complete `dataset` with linked `dataset_rows` and `sources` exists and is queryable via the API, independent of the agent process.

## Phase 8 — Task Monitoring UI
**Goal:** Users can watch a workflow run live.
- Build the live workflow monitor page (stage checklist, progress bars, running counts) consuming the SSE stream from `/api/workflows/:id/stream`.
- Build the workflow history list page.
**Completion criteria:** A user can submit a prompt, watch it progress stage-by-stage in real time, and see it land in their workflow history when done (or failed).

## Phase 9 — Dataset Dashboard (Explorer)
**Goal:** Users can browse, search, and filter results.
- Build the dataset table view (TanStack Table) with column-based search/filter.
- Build the dataset list/overview page (per `PRD.md` FR-15).
**Completion criteria:** A user can open a completed dataset, search/filter its rows by any field, and the results update correctly and performantly.

## Phase 10 — Source Traceability
**Goal:** Every record is explainable.
- Build the row-detail / "inspect source" drawer showing all linked `sources` for a record (URL, title, retrieved_at, snippet).
**Completion criteria:** Clicking any row in the dataset explorer reveals the exact source(s) and evidence used to populate it.

## Phase 11 — Export
**Goal:** Users can take their data out of the platform.
- Implement CSV, JSON, and Excel export for a full dataset and for a filtered subset.
- Log every export to the `exports` table.
**Completion criteria:** A user can export a filtered view of a dataset in all three formats and the downloaded file matches the filtered rows exactly.

## Phase 12 — Testing & Deployment
**Goal:** Ship it.
- Add basic automated tests: requirement parser output validation, data-engine dedup/validation unit tests, API route auth checks.
- Deploy frontend/API to Vercel, MySQL to a managed provider, Firecrawl self-hosted (Docker) or via hosted API key.
- Final QA pass against every Functional Requirement in `PRD.md` §5.
**Completion criteria:** The full user journey (prompt → live monitoring → dataset → filter → export) works end-to-end on the deployed production URL.

---

## Phase Discipline Rule
Do not start a phase until the previous phase's completion criteria are met and recorded in `Memory.md`. Do not implement features from a later phase "early" even if convenient — this causes context loss and half-finished dependencies that are hard for a fresh AI session to reason about.
