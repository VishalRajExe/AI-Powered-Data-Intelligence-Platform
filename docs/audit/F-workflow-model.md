# F. Workflow Model

## F.1 The non-negotiable requirement

Natural language must actually drive the system. Concretely, the prompt — and nothing else —
determines: objective, entity type, fields, filters, source strategy, step sequence, and the
output dataset.

The old project violated this through keyword matching (`scenarios.data.ts:453-459`,
`dynamic-scenario.generator.ts:127`) and silent demo substitution
(`requirements/index.ts:17-19`, `planner/index.ts:19-21`, `server.ts:56-62`). In FINALAIAGENT:

- **No keyword matcher exists anywhere.** No `prompt.includes(...)`, no scenario table, no
  template registry keyed by topic.
- **No fallback provider.** A missing `GEMINI_API_KEY` or `FIRECRAWL_API_KEY` is a **startup
  failure**, not a degraded mode. This inverts the old behaviour and is the single most
  important structural change.
- **No `DEMO_MODE`.** Tests use mocks and fixtures; production has one code path.
- **Every plan is validated before execution.** Invalid AI output never reaches the engine.
- **The accepted test is differential:** three unrelated prompts must produce three
  structurally different plans (different entity types, different field sets, different step
  sequences, different source strategies). If any two collapse to the same shape, the planner is
  hardcoded and the phase fails. See `M-phase-plan.md` Phase 4 exit criteria.

## F.2 Two-stage AI, deterministic execution

```
prompt ──► [Python: Requirement] ──► [Java: validate] ──► [Python: Plan DAG]
                                                              │
                                                    [Java: validate DAG]
                                                              │
                                                persist WorkflowPlan (versioned)
                                                              │
                                        [Java job engine executes steps deterministically]
```

The LLM decides **what** to collect. Java decides **whether and when** it runs. Python decides
**how** each step extracts. There is exactly one orchestrator (Java), so there is exactly one
source of truth for step state.

Why not an autonomous agent loop: with two orchestrators, step state exists in two places, and
reconciling them is where the old project's integration bugs lived. The Firecrawl TS core's
autonomy (deepagents, subagents, compaction) exists because it owns orchestration; we do not
need it and should not import it.

## F.3 Stage 1 — Requirement contract

Produced by Gemini structured output, validated twice (Pydantic in Python, Bean Validation in
Java). Ported from `requirements/requirement.schema.ts`.

```
Requirement {
  objective            string            // what the user actually wants, in one sentence
  entityType           string            // "youtube_channel" | "job_listing" | "startup" | …
                                           // FREE TEXT, not an enum — an enum would cap it
  quantity             int?              // requested count; null if unstated
  geography { places[], scope, includeSubregions }
  timeRange            { from?, to?, relative? }
  filters[]            { field, operator, value }     // 12 operators
  constraints[]        string
  fields[]             { key (snake_case), label, type, description? }
  requiredFields[]     string            // ⊕ optionalFields — every field must be in exactly one
  optionalFields[]     string
  sourcePreferences[]  string            // e.g. "official career pages", "video platform"
  sourceRestrictions[] string            // e.g. "no aggregator sites"
  deduplicationKeys[]  string
  validationRules[]    { rule, field?, params? }
  outputFormat         csv|json|xlsx|unspecified
  ambiguities[]        string            // what the model was unsure about
  missingInformation[] string            // what it could not determine
  warnings[]           string
}
```

Two rules carried forward because they are what prevents fabrication:

1. **Cross-validation:** every entry in `fields` must appear in exactly one of `requiredFields`
   or `optionalFields`. A field that is neither is a contract bug and must fail validation.
2. **`validationStatus`** is derived, not guessed: `valid` only when entity, objective and at
   least one field are resolved and `missingInformation` is empty; otherwise
   `needs_clarification`, which returns **422 with the clarifying questions** rather than
   proceeding (`parser.service.ts:50-70`, `planner.service.ts:24-29`). This is PRD FR-3 and the
   old project got it right.

Field inference is permitted **only** as prompt guidance: when the user names no fields, the
model may propose 4-6 sensible ones for that entity type (`requirements/prompt.ts:12`). Those
proposals are then shown to the user for confirmation in the plan-preview screen. The prompt's
examples (`channel_name/channel_url/subscribers`, `title/employer/location/url`) stay in the
prompt as illustrations — **never as code defaults**. The old
`requirements.routes.ts:15,32` turned absence into `entity:"Record"` and `targetCount:100`;
that is dropped.

## F.4 Stage 2 — Plan DAG

Ported from `planner/workflow-plan.schema.ts`. Validated bounds:

| Constraint | Value | Source |
|---|---|---|
| Step count | 2-30 | `:144` region |
| Step vocabulary | fixed enum (F.5) — **the model may not invent step types or tool names** | `Memory.md:47` |
| Dependencies | must reference **earlier** steps (acyclic by construction) | schema rule |
| Mandatory steps | ≥1 `EXTRACT` **and** ≥1 `SAVE` | `:144-145` |
| Per-step `retryPolicy` | `maxAttempts ≤ 5`; strategy `none`\|`exponential`; `retryableErrors ⊂ {TIMEOUT, RATE_LIMIT, TRANSIENT_NETWORK, SERVER_ERROR}` | schema |
| Per-step `timeoutMs` | 1 000 - 300 000 | schema |
| `maxRequestsPerDomainPerMinute` | ≤ 60 | schema |
| `searchStrategy.queries` | ≤ 30 | schema |
| `extractionSchema` | JSON Schema object, `additionalProperties: false` | schema |
| Safety literals | `respectRobotsTxt=true`, `respectSiteTerms=true`, `allowAuthentication=false`, `allowCaptchaBypass=false`, `requireSourceEvidence=true` | `:61-64` — **Java constants, not model output** |
| Plan↔requirement | plan fields must agree with the requirement's fields | `:166-182` |

Generation uses a **2-attempt validate→correct loop**: on validation failure, the issues are
serialized back into the prompt and the model is asked once more; a second failure is persisted
as `planning_status=FAILED` with a sanitized error code (`planner.service.ts:45-80`). No canned
plan is ever substituted.

## F.5 Step vocabulary

| Step | Runs in | What it does |
|---|---|---|
| `PLAN` | Java | Record the planning decision; normally implicit |
| `SEARCH` | Python → Firecrawl `search` | Turn `searchStrategy.queries` into candidate URLs |
| *(governance)* | **Java** | Not a model-chosen step: SSRF, allow/block, robots (fail closed), relevance rank, per-domain rate budget. Persists `sources` lifecycle |
| `SCRAPE` | Python → Firecrawl `scrape` | Fetch cleared URLs as markdown |
| `INTERACT` | Python → Firecrawl `interact` | Page interaction where scraping is insufficient. **Never in parallel fan-out** (browser sessions are heavy — `worker/index.ts:61-64`); hard 60s timeout (`toolkit.ts:4,51-102`) |
| `EXTRACT` | Python → Gemini structured output | Markdown → records conforming to `extractionSchema`, with per-record `sourceUrls`. Schema-validation gate + bounded repair (F.7) |
| `TRANSFORM` | Python | Normalization: aliases, whitespace, URL, date, numeric, currency, phone, country |
| `VALIDATE` | Python (advisory) + **Java (authoritative)** | Type/required/format/enum checks against the contract |
| `DEDUPLICATE` | Python | Blocking-index exact + normalized matching; duplicates **linked**, never deleted |
| `MERGE` | Python | Entity resolution; merges only when a shared stable identifier exists |
| `VERIFY` | Python → Gemini | **New.** Critique stage: does the record set actually satisfy the objective? Emits `{feedback, terminate, final_response}` and a decision `advance \| retry-step \| replan \| terminate` |
| `SAVE` | Java | Transactional persist: dataset, columns, rows, evidence, validation issues, dedup events, quality report |
| `EXPORT` | Java | Real queued export job (the old runner always `SKIPPED` this) |

## F.6 The workflow is dynamic — worked examples

These are the shapes the planner must be able to produce. They are **illustrations of required
variation, not templates** — no code may contain them.

**A. "find best youtube channels for coding"**
```
entityType: youtube_channel     fields: channel_name, channel_url, subscriber_count,
                                        primary_topics, description
SEARCH → SCRAPE → EXTRACT → TRANSFORM → VALIDATE → DEDUPLICATE → SAVE
sourcePreferences: video platform, curated community lists
deduplicationKeys: [channel_url]
validationRules: URL format on channel_url; NUMBER on subscriber_count
```
Note what is absent: no `funding`, no `founder`, no country filter, no cross-check step. The
old system returned 15 hardcoded channels for this prompt
(`dynamic-scenario.generator.ts:16-127`).

**B. "find 100 AI startups in India founded after 2020 with founder, funding and website"**
```
entityType: company             quantity: 100      geography: {places:["India"]}
                                timeRange: {from: 2020}
fields: company_name, founder, website, funding, location
SEARCH → SCRAPE → EXTRACT → TRANSFORM → VALIDATE → MERGE → VERIFY → SAVE
deduplicationKeys: [company_name, website]
```
Differs from A by `quantity`, `geography`, `timeRange`, the `MERGE` step (entity resolution
across directories that name the same company differently) and `VERIFY` (funding figures
conflict across sources, so a critique pass is warranted).

**C. "find remote frontend developer jobs in India with salary and application URL"**
```
entityType: job_listing         geography: {places:["India"]}
fields: title, employer, location, salary_min, salary_max, currency,
        employment_type, application_url
filters: [{field: employment_type, operator: eq, value: remote}]
SEARCH → SCRAPE → EXTRACT → TRANSFORM → VALIDATE → DEDUPLICATE → SAVE
validationRules: URL on application_url; RANGE on salary (salary_min ≤ salary_max)
deduplicationKeys: [employer, title, application_url]
```
Differs by the RANGE validation rule, the currency field, and a filter that the planner must
push into the search queries rather than post-filter.

**D. "find technology sponsors for a college hackathon"**
```
entityType: sponsorship_prospect
fields: organization_name, industry, website, sponsorship_page, contact_email
sourcePreferences: official developer-relations and sponsorship pages
sourceRestrictions: no job boards
SEARCH → SCRAPE → INTERACT → EXTRACT → TRANSFORM → VALIDATE → DEDUPLICATE → SAVE
```
`INTERACT` appears because sponsorship details are often behind a nav menu or a form — the
planner chooses it, the code does not.

Four prompts, four different entity types, four different field sets, three different step
sequences. That variation is the acceptance test.

## F.7 Extraction integrity gates (ported from the TS core)

Two mechanisms, both absent from `agent-core-py`, both essential:

1. **Schema-validation gate with bounded repair.** Extracted JSON is validated against
   `plan.extractionSchema` using one validator shared by prompting, runtime gating and post-run
   assessment (`schema-validate.ts:126-150`; the deliberate single-validator design is at
   `:1-14`). Arrays are validated item-by-item, the walk is depth-capped, and an empty value
   counts as missing. On failure the issues are fed back for repair, capped at
   **`MAX_SCHEMA_REPAIRS = 3`** (`agent.ts:76,97-118`). After three failures the step fails —
   it does not return approximate data.
2. **No answer before data.** A final/structured result is **rejected unless at least one data
   tool returned non-empty content** (`agent.ts:37-40,42-66`). This is what stops a model from
   emitting a complete-looking dataset that was never collected.

Plus the rule the old project implemented well and must keep: **only source URLs actually
observed in tool results count as evidence.** Model-claimed URLs are recorded with
`verified_by_tool=false` and records with no observed source are flagged
`SOURCE_EVIDENCE_UNVERIFIED` (`AgentResultNormalizer.ts:41-49,169`). And a snippet only
corroborates a value if the value's tokens literally appear in it, else `is_verified=false`
(`provenance.service.ts:12-48`).

**Gemini-specific constraint:** Gemini rejects the `const` keyword in tool/extract schemas
(`agent-core/README.md:399-401`). Since Gemini is our default provider, schema generation must
strip `const` — a concrete failure mode that would otherwise appear only at runtime.

## F.8 Execution semantics

| Concern | Design | Contrast with the old project |
|---|---|---|
| Scheduling | Real DAG: a step becomes eligible when all `depends_on` steps are `COMPLETED`. Eligible independent steps may run **in parallel** under a bounded executor | Old runner was sequential only; dependencies were used merely to mark steps `SKIPPED` (`workflow-runner.ts:24,58-64`) |
| Progress | Derived from actual step states (completed/total, weighted), persisted on the run row | Old list endpoint synthesized `COMPLETED→100, RUNNING→50, else 0` (`workflows.routes.ts:92`) |
| Per-step retry | Honour the plan's `retryPolicy`; exponential backoff **with jitter**; `attempt_count` persisted | Old honoured the plan but BullMQ had no queue-level `attempts`/backoff |
| Cancellation | Cooperative at step boundaries; `cancel_requested_at` persisted immediately; in-flight HTTP bounded by its own timeout | Same as old (`Memory.md:114`) — Firecrawl offers no run-level abort, so this limitation is inherited honestly, not hidden |
| Crash recovery | Lease expiry resets `RUNNING` → `PENDING`; the run resumes from persisted step state | **Absent before.** BullMQ job loss on restart stranded runs |
| Failure isolation | A blocked/failed source is `SKIPPED`/`BLOCKED`/`FAILED` with a reason and never aborts the run. The run ends `PARTIAL` if some records were still produced | Old did isolate source failures, but silently dropped unevidenced rows (`workflow-execution.repository.ts:271-272`) — we record them instead |
| Terminal-state writes | In a **fresh transaction** (`REQUIRES_NEW`), never in the cancelled/timed-out job's context | **Absent before.** Anakin's `persistCtx` insight (`processor.go:24-33`): otherwise a timed-out job sticks in `RUNNING` forever |
| `VERIFY` loop caps | Hardcoded max iterations and max replans, enforced in Java | TheAgenticBrowser had **no** cap — termination was 100% LLM-decided and a swallowed exception could livelock it (`orchestrator.py:532,606-615`) |

## F.9 Step-state machine

```
PENDING ──► RUNNING ──► COMPLETED
   │           │
   │           ├──► FAILED   (attempts exhausted)
   │           ├──► BLOCKED  (governance: robots disallow, blocked domain, SSRF)
   │           ├──► SKIPPED  (dependency not satisfied, or not applicable)
   │           └──► CANCELLED
   └──► SKIPPED / CANCELLED
FAILED ──► PENDING (retry scheduled, attempt_count < max_attempts)
```
Enforced by an explicit transition table in Java plus `WHERE status = <expected>` on every
UPDATE. An illegal transition throws rather than being ignored.

Next: `G-api-map.md`.
