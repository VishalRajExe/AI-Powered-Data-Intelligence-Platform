# Rules.md — Project Constitution
### Project: Scoutly

> This file defines **CONSTRAINTS**: what the AI is allowed and forbidden to do while building this project. It does not describe what to build (`PRD.md`), how it's architected (`Architecture.md`), or in what order (`Phases.md`). If a rule here conflicts with a convenience shortcut elsewhere, this file wins.

---

## 1. Allowed Technologies

- **Frontend:** Next.js (App Router), React, TypeScript, Tailwind CSS, shadcn/ui, TanStack Table, TanStack Query.
- **Agent core:** `firecrawl/web-agent` (Deep Agents/LangChain harness) and its official tool bindings (`firecrawl-aisdk`, `@mendable/firecrawl-js`). Do not replace this core without an explicit decision recorded in `Memory.md`.
- **LLM:** Anthropic Claude models via the official SDK. Other providers may only be added as fallback, never as a silent default swap.
- **Database:** MySQL only. ORM: Prisma or Drizzle (pick one at Phase 1 and do not mix).
- **Job/async handling:** BullMQ + Redis, or a DB-backed job table if Redis is not yet provisioned. Never use in-memory-only job tracking for anything the user needs to monitor across page reloads.
- **Auth:** NextAuth.js or Clerk. Must support persistent per-user sessions.
- **Export libraries:** `papaparse` or native serialization for CSV/JSON; `exceljs` or `SheetJS (xlsx)` for Excel.
- **Dedup/fuzzy matching:** a maintained, permissively licensed (MIT/BSD/Apache-2.0) library only.

## 2. Prohibited / Restricted

- **No AGPL-licensed code or libraries** may be imported into this codebase without an explicit written exception approved and logged in `Memory.md`, because AGPL's network-use clause can force the entire product to be open-sourced. This includes not copying code from AGPL-licensed reference repos (e.g., job-queue/dashboard inspiration repos noted during research) — architecture ideas may be studied, code may not be copied.
- **No code from a "Community License" or other source-available (non-OSI) license** may be merged into this repo without the same explicit, logged exception. Studying such a repo's architecture is fine; copying its code is not.
- **No scraping of a source that:**
  - Disallows the target path via `robots.txt`, or
  - Requires bypassing a login wall, CAPTCHA, or paywall, or
  - Explicitly prohibits automated collection in its Terms of Service (where reasonably knowable).
  - Any violation of this rule is treated as a critical bug, not a feature trade-off.
- **No silent data fabrication.** If the agent cannot find a field, the field must be left null/empty with a reason, never guessed or hallucinated to "complete" a record.
- **No client-side secrets.** API keys (Firecrawl, Anthropic, DB credentials) must only ever exist server-side / in environment variables, never shipped to the browser bundle.
- **No blocking the main request thread** for long-running agent executions — all multi-minute workflows must run as background jobs with a status the frontend can poll/stream, never a synchronous request that times out.
- **No mixing ORMs or query builders.** Pick Prisma or Drizzle once; do not introduce a second data-access pattern later.
- **No arbitrary `eval`/dynamic code execution** on extracted content unless it runs inside the agent's already-sandboxed bash tool.

## 3. Coding Conventions

- TypeScript strict mode on across the whole repo — no `any` without a comment explaining why.
- All API routes must validate input with a schema library (e.g., Zod) before touching the database or the agent.
- All database access goes through the `packages/db-schema` client — no raw SQL scattered across API routes except for explicitly justified performance-critical queries.
- Every agent "Skill" (`SKILL.md`) must be documented with: what entity type it targets, what fields it produces, and any source constraints specific to it.
- Naming: `snake_case` for DB columns, `camelCase` for TypeScript variables/functions, `PascalCase` for components/types.

## 4. Error Handling

- Every workflow step must catch its own failures and record `{status: "error", reason: string}` in `workflow_steps` rather than crashing the whole workflow run.
- A single failed/blocked source must be skipped, logged, and excluded from the dataset — it must never abort the entire workflow.
- User-facing errors must always be actionable ("This source blocked automated access and was skipped" — not a raw stack trace).
- All server-side errors must be logged with enough context (workflow_id, step, source URL) to debug without reproducing.

## 5. Validation Rules

- Every extracted record must be checked against its Data Contract's field types before being written to `dataset_rows` (e.g., emails must match a valid email pattern, URLs must be well-formed, numeric fields must parse as numbers).
- Records failing validation are not silently dropped — they are flagged (`is_valid: false` + reason) so the pipeline stays auditable, unless explicitly configured to discard invalid rows.
- Deduplication must never destructively delete a record; duplicates are merged/linked (`is_duplicate_of`), preserving the original for traceability.

## 6. Logging Requirements

- Every workflow run must produce a step-by-step, timestamped log persisted to `workflow_steps` (not just console output).
- Every dataset row must be traceable to at least one `sources` entry; a row with zero linked sources is treated as a data-integrity bug.
- Export actions must be logged in the `exports` table (who, when, what filter, what format) for auditability.

## 7. Dependency Rules

- No new dependency may be added without checking its license (must be MIT/BSD/Apache-2.0/ISC or equivalent permissive license).
- Prefer dependencies already used by `firecrawl/web-agent`'s stack (Deep Agents/LangChain ecosystem, `firecrawl-aisdk`) over introducing a parallel/competing library for the same job.
- Pin exact versions for the agent core and Firecrawl SDKs; do not auto-upgrade major versions without testing the full agent pipeline.

## 8. Things the AI Must Never Do Without Explicit Justification (logged in `Memory.md`)

- Replacing the `firecrawl/web-agent` core with a different agent framework.
- Switching the primary database engine away from MySQL.
- Adding a second LLM provider as the default reasoning engine.
- Copying source code from any repository whose license has not been explicitly verified as permissive.
- Storing raw personal data beyond what's needed to fulfill the user's stated data contract (privacy minimization).
- Bypassing the source-governance check (§2) "just for testing" — test against permissive/sample sources instead.
- Skipping the async job pattern for "just one quick synchronous endpoint" — this always breaks later at scale.
