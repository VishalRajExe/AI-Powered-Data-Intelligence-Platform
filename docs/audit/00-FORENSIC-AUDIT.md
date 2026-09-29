# Forensic Audit — Old Project & Reference Repositories

**Phase 0 deliverable (findings).** Target project: `FINALAIAGENT`. Audit date: 2026-09-28.
Scope: `AI-Powerd Data Intelligence` (backend + PirateAgentUI + docs), `web-agent-main`,
`web-research-agent-master`, `TheAgenticBrowser-main`, `anakin-master`.

Method: full source inspection, not documentation review. Every claim below cites a file.
Where the old project's `Memory.md` asserts something the code contradicts, the code wins
and the contradiction is called out.

---

## 1. Root cause of the "hardcoded startup schema" complaint

The behaviour you described — any prompt returning `company_name / founder / website /
funding` with Tracxn/Inc42/YourStory sources — is **not** an LLM failure. It is three
silent fallbacks that substitute a fabricated demo implementation whenever a credential is
missing:

| Trigger | Location | Effect |
|---|---|---|
| `DEMO_MODE=true` **or no LLM key** | `backend/src/modules/requirements/index.ts:17-19` | Requirement parsing is served by `DemoRequirementProvider` — no LLM call at all |
| `DEMO_MODE=true` **or no LLM key** | `backend/src/modules/planner/index.ts:19-21` | Workflow planning served by `DemoWorkflowPlanProvider` — fixed 6-step plan |
| `!DEMO_MODE && !FIRECRAWL_API_KEY` | `backend/src/server.ts:56-62` | Collection served by `DemoAgentAdapter` ("dynamic adaptive simulation") |

The demo layer then keyword-matches the prompt to one of three hardcoded scenarios:

- `backend/src/modules/demo/scenarios.data.ts:453-459` — matcher
  `("ai startup" | "indian ai" | "startups in india") && ("2020" | "founder" | "funding")`
- Scenario 1 hardcodes sources `inc42.com/reports/indian-ai-startups-2024` (:29),
  `yourstory.com/companies/ai-startups-india` (:30),
  `tracxn.com/explore/Artificial-Intelligence-Startups-in-India` (:31), plus a deliberately
  broken `unreachable-source.example.com/404` (:33).
- It hardcodes **52 real startup rows** (:36-88) and **50 fabricated startups** from a fixed
  brand list, each with founder `Dr. Ramesh Gupta ${i+1}` and website `https://<slug>.in`
  (:117-150), plus planted duplicates/conflicts and a fixed extraction schema
  `company_name, founder, website, funding, location, source_url`.
- Scenario 2 (jobs) and Scenario 3 (sponsors) follow the same pattern (:228-334, :343-435).
- Any prompt that matches nothing falls to
  `backend/src/modules/demo/dynamic-scenario.generator.ts`, which has a hardcoded
  `YOUTUBE_TEMPLATE` (:16-123) containing **15 real hardcoded YouTube channels**
  (freeCodeCamp 9.8M, Fireship, Traversy, …) triggered by
  `p.includes("youtube"|"channel"|"video"|"coding")` (:127), and a generic
  "Directory Record" template emitting `Item 1..N` on `example.com` (:132-181).

**This is exactly your "find best youtube channels for coding" example.** That prompt hits
the `YOUTUBE_TEMPLATE` keyword trigger and returns 15 hardcoded channels — the system never
contacted the web.

The real parsers are genuinely dynamic and were never the problem:
`requirements/requirement.schema.ts` is a strong contract (objective, entityType, quantity,
geography, timeRange, filters with 12 operators, fields with types, requiredFields ⊕
optionalFields cross-validated, sourcePreferences/Restrictions, deduplicationKeys,
validationRules, ambiguities, missingInformation), and `requirements/prompt.ts:12` only
offers field examples as *LLM guidance*, not code fallbacks. The demo layer shadows them.

Git history corroborates: commit `212fe5a` is titled
`fix: dynamically parse arbitrary requests, activate Gemini API, and resolve prompt-matching
fields/sources` — i.e. Gemini was not active and prompt-matching was in play until very late.

**Verdict:** the entire `backend/src/modules/demo/` tree must be dropped, and the three
fallbacks replaced with hard startup failure when credentials are missing.

---

## 2. The live collection path was never runnable

From the working tree's `.env` (values not reproduced here):

- `DEMO_MODE=false`
- `FIRECRAWL_API_KEY` — **empty (0 characters)**
- `GEMINI_API_KEY` — populated (53 chars)
- `LLM_PROVIDER=google`, `LLM_MODEL_ID=gemini-2.5-flash`, `APP_ENV=development`, `PORT=4000`

With no Firecrawl key, `server.ts:56-59` installs `DemoAgentAdapter`. So even with
`DEMO_MODE=false`, **all collection was simulated**. `Memory.md:112` admits it:
"No live Firecrawl/LLM request was run during Phase 5 … Live provider behavior remains
unverified." The gated live test `backend/tests/agent.integration.test.ts:19` requires
`RUN_FIRECRAWL_INTEGRATION_TESTS=true` and is skipped by default.

Consequence: the 213 passing tests and the "98.1% success rate / 52 records / 14 verified
sources" metrics in `Memory.md:31` were produced by the simulator, not the web. The 24
checked-in artifacts under `backend/demo-exports/` are demo outputs.

Also: `Memory.md:118` states "No `.env` file exists." Two do (`.env` and `backend/.env`,
byte-identical, 22 populated variables). They are gitignored and **not** tracked by git
(verified via `git ls-files`), so nothing leaked into history — but the documentation claim
is false and the duplicated file is a config-drift hazard.

---

## 3. Documentation contradicts code — authorization is effectively absent

`Memory.md:117` claims: "Authentication and authorization are fully active as of Phase 13 …
client identity anti-spoofing is enforced across all routes." `Memory.md:29` claims
`requireWorkspaceAccess` enforces membership and role hierarchy.

Actual state:

- `backend/src/app.ts:71-74` mounts **only `optionalAuthenticate`** globally.
- `requireWorkspaceAccess` exists in `auth/auth.middleware.ts` but is **never mounted on any
  business route**.
- `backend/src/routes/datasets.routes.ts:13` contains the literal comment "auth placeholder".
- All dataset/run/workflow/export routes accept `workspaceId` and `userId` as **query or body
  parameters**. Membership is checked inside repositories, but with no Bearer token nothing
  verifies the caller *is* that `userId`.
- `enforceClientIdentity` only fires when a token is present.

**Impact: an unauthenticated caller who guesses or obtains a workspace UUID can read that
workspace's data.** `GET /api/v1/auth/me` is the only route requiring authentication.

Additional auth weaknesses:
- `backend/src/server.ts:83-86` falls back to literal JWT secrets
  (`default_development_jwt_access_secret_min_32_chars!`) when env is unset → tokens are
  forgeable. `docker-compose.yml` does the same with `insecure-default-…` strings.
- `prisma/seed.ts:39-69` seeds a working demo login `demo@pirateagent.ai` / `Demo1234!`.
- `auth/token.service.ts:133-139,145-155` **silently swallows Redis revocation failures**,
  so logout can degrade to per-process memory without any signal.
- Refresh tokens rotate and revoke the old `jti`, but there is no reuse/replay detection.

---

## 4. Fabricated values inside real (non-demo) API routes

These are not in the demo tree — they are in production route handlers, added to make the
frontend look complete. They must not survive:

| Location | Fabrication |
|---|---|
| `routes/workflows.routes.ts:92` | Synthetic progress: `COMPLETED→100, RUNNING→50, else 0`. Real progress exists on the run row but is not used |
| `routes/datasets.routes.ts:240-243` | Confidence coerced to 0-100 with **default `90` when null** |
| `routes/datasets.routes.ts:251` | **Fabricated `sourceIds: ["src-1", …]`** when a row has no linked sources |
| `routes/requirements.routes.ts:15,32` | `entity` defaults to `"Record"`, `targetCount` defaults to **100** |
| `modules/demo/demo-agent.adapter.ts:82-93` | Invented telemetry: durationMs 250, inputTokens 750, outputTokens 1500, toolCallCount 6 |
| `modules/demo/demo-agent.adapter.ts:21-28` | `checkConfiguration()` always returns `configured:true` → `GET /health/firecrawl` lies in demo mode |

The frontend independently invents the same things (see `D-frontend-reuse-map.md`):
`datasets/[id]/page.tsx:120-131` defaults confidence to 90 and synthesizes `src-1…src-n`.
Fabrication exists on **both sides** of the contract, so neither can be trusted as-is.

---

## 5. Genuinely good work worth porting

The old project is not a write-off. These are real, tested, and well-designed:

1. **`prisma/schema.prisma`** — 16 models, 17 enums, 7 migrations. UUID `Char(36)` keys, and
   every child table carries `workspaceId` with **compound tenant-scoped foreign keys**
   (e.g. `(workspaceId, datasetId)`), which structurally prevents cross-tenant links. This is
   the single most valuable artifact. See `E-database-model.md`.
2. **`requirements/requirement.schema.ts` and `planner/workflow-plan.schema.ts`** — the two
   contracts that encode real product semantics: 10-step vocabulary, 2-30 steps, per-step
   retry policy (maxAttempts ≤5, exponential, retryable error whitelist), timeouts 1s-300s,
   dependencies must reference earlier steps, **plan must contain ≥1 EXTRACT and ≥1 SAVE**
   (:144-145), hardcoded safety literals `respectRobotsTxt=true, respectSiteTerms=true,
   allowAuthentication=false, allowCaptchaBypass=false` (:61-64), and cross-validation of plan
   against requirement fields (:166-182).
3. **`planner/planner.service.ts:45-80`** — a 2-attempt generate→validate→correct loop that
   feeds Zod issues back to the model. Correct pattern for unreliable structured output.
4. **Data-intelligence pipeline** (`modules/data-intelligence/`) — deterministic, in-process,
   well tested: alias folding, URL/date/phone/currency/country normalization, type/required/
   format/enum validation, blocking-index deduplication, Levenshtein entity resolution with
   legal-suffix stripping (threshold 0.94), conservative merge that preserves conflicts.
   `RANGE`/`CUSTOM` rules are honestly downgraded to WARNING rather than faked
   (`ValidationService.ts:63`).
5. **Anti-hallucination integrity backbone** — two mechanisms that actually work:
   - `agent/AgentResultNormalizer.ts:41-49` keeps only source URLs **actually observed in tool
     results**; model-reported URLs are marked `verifiedByTool=false` and records lacking
     observed sources are flagged `SOURCE_EVIDENCE_UNVERIFIED`.
   - `evidence/provenance.service.ts:12-48` (`isSnippetVerifyingValue`) only claims a snippet
     corroborates a value if the value's tokens literally appear in the snippet, else
     `isVerified:false`.
6. **Source governance** (`modules/sources/`) — `SourceValidator` SSRF guard (RFC1918,
   loopback, CGNAT, `169.254.169.254` metadata, IPv6 forms) plus DNS preflight against
   rebinding; `RobotsPolicyService` **fails closed**; `SourcePolicyService` persists a real
   lifecycle `DISCOVERED→ALLOWED→QUEUED→PROCESSING→COLLECTED|BLOCKED|SKIPPED|FAILED`;
   `RelevantSourceSelector` ranks search results (token coverage 0.55 title / 0.30 snippet /
   0.15 URL, phrase boost 0.25, domain preference 0.15, floor 0.12, per-domain repeat penalty
   0.08, canonical-URL dedupe).
7. **Monitoring design** — every event is persisted to `activity_events` in MySQL *before*
   pub/sub, so SSE can replay history on reconnect with `Last-Event-ID`
   (`modules/monitoring/event-broadcaster.ts:56-99`, `routes/runs.routes.ts:89-171`). MySQL as
   authoritative log is exactly what a no-Redis architecture needs.
8. **Export streaming** — chunked (default 500 rows) RFC 4180 CSV, streamed JSON array,
   ExcelJS streaming `WorkbookWriter`, SHA-256 checksum, and a path-traversal guard on
   download (`export.repository.ts:122-128`).
9. **`agent/FirecrawlAgentAdapter.ts`** (427 lines) — a proven governance wrapper: enables only
   the tools implied by the validated plan (:168-177), gates every URL through public-host and
   blocked-domain checks plus a per-domain rate window (:242-309), post-filters search results
   through governance and relevance ranking (:311-345), clamps `maxSteps` to 6-40, and redacts
   secrets from errors (:403-419).

---

## 6. Broken, unfinished, or structurally wrong

| # | Finding | Evidence |
|---|---|---|
| 1 | Authorization effectively absent (see §3) | `app.ts:71-74`, `datasets.routes.ts:13` |
| 2 | Exports are **not queued** — in-process promises; a restart strands jobs in `RUNNING` forever. `EXPIRED` status and `expiresAt` exist in schema but no sweeper enforces them | `export.service.ts:41-53` |
| 3 | `GET /api/v1/rows/:id/evidence` calls `getRowEvidence(workspaceId, id, userId)` with 3 args where the signature elsewhere is 4 args `(workspaceId, datasetId, rowId, userId)` — live bug or hidden overload | `datasets.routes.ts:308` |
| 4 | Workflow runner is **sequential only**; plan dependencies are used merely to mark steps `SKIPPED`, never to parallelize. "parallel execution is intentionally disabled" | `workflow-runner.ts:24,58-64` |
| 5 | `EXPORT` step always `SKIPPED` with `EXPORT_NOT_IN_PHASE` despite Phase 12 claiming export is done | `workflow-runner.ts:167-169` |
| 6 | BullMQ misconfigured: no queue-level `attempts`/backoff; `jobId = runId` means a failed run can **never** be re-enqueued under the same id; worker concurrency hardcoded to 2 | `workflow-execution.service.ts:32`, `server.ts:79` |
| 7 | `persistDataset` **silently drops** records lacking linked verified sources (`continue`), only erroring if *all* records drop — a dataset can land `PARTIAL` with unexplained row loss | `workflow-execution.repository.ts:271-272,352` |
| 8 | Dataset row search is `LIKE '%…%'` over a JSON column via raw SQL — no fulltext index, will not scale | `dataset-query.repository.ts:732-741` |
| 9 | Confidence semantics inconsistent: DB stores `Decimal(5,4)` 0-1, rows endpoint returns 0-100 with default 90, exports write raw values | `datasets.routes.ts:240-243` |
| 10 | HTTP rate limiter is per-process in-memory, not distributed | `common/rateLimiter.ts` |
| 11 | Deployment topology cannot work: compose runs backend on **:3000** and sets `FRONTEND_ORIGIN=localhost:5173` (a Vite port), but `PirateAgentUI/next.config.js:15-22` hardcodes the API rewrite to `localhost:**4000**` | `docker-compose.yml`, `next.config.js` |
| 12 | `backend/.env.example` does not exist although README references it | `backend/` listing |
| 13 | `dist/` build output and `demo-exports/` artifacts are committed to the tree | repo listing |
| 14 | `demo-scenarios.test.ts` and much of `e2e-validation.test.ts` **assert the hardcoded demo fixtures** — tests that lock in demo behaviour rather than production behaviour | `tests/` |
| 15 | `Architecture.md` is stale: it describes Next.js API Routes as the backend, "Prisma or Drizzle", BullMQ as optional, and a `scoutly/apps/web` folder structure that was never built. `Design.md` specifies a white/blue `#3B5BFF` Inter system; the shipped UI is parchment/brown with Cormorant Garamond | `md files/` vs `PirateAgentUI/app/globals.css:6-43` |
| 16 | **The project does not build in this checkout.** `node_modules/@aidp/backend` and `node_modules/@aidp/firecrawl-agent-core` are empty directories rather than workspace links, so the vendored package cannot resolve | `npm run typecheck` → **10 × TS2307**, exit 1 (`N` §N.2) |
| 17 | Both lint gates fail | `npm run lint` → **14 errors**; `npm run lint:frontend` → **32 errors** (`N` §N.1) |
| 18 | The test suite fails to load 3 of 20 files for the same reason | **195 passed / 202 collected**, not the claimed 213 (`N` §N.1, §N.3) |
| 19 | `src/scripts/check-apis.ts` is **orphaned** — no npm script invokes it. The frontend has **no `typecheck` script** at all, so types are only checked as a side effect of `next build` | `grep -rn check-apis package.json` → no match (`N` §N.4) |

§§16–19 were established by **running** the toolchain on 2026-09-29, not by reading it, and are
documented in full in [`N-scripts-and-dependencies.md`](N-scripts-and-dependencies.md): root cause,
the claim-vs-measured table against the old `Memory.md`, broken scripts, and dependency findings —
including one apparent defect that turned out to be correct and must **not** be "cleaned up"
(the seven provider `peerDependencies`).

---

## 7. Licensing constraints (binding on the rebuild)

`md files/Rules.md:21-22` prohibits AGPL code and any "Community License"/source-available
code without a logged exception. Verified license facts:

| Repo | License | Verified at | May we copy code? |
|---|---|---|---|
| `web-agent-main` (`agent-core`) | **MIT** (declared `"license": "MIT"`; no LICENSE file upstream) | `agent-core/package.json:118`; vendored `packages/firecrawl-agent-core/LICENSE` "MIT … Copyright (c) 2026 Firecrawl" | **Yes**, keep provenance |
| `web-research-agent-master` | **MIT** (Copyright (c) 2025 Dev Dalia) | `LICENSE:1-3` | **Yes** |
| `TheAgenticBrowser-main` | **TheAgentic Community License v1.0** — §1.1 "Excluded Purpose" bars "making available any software-as-a-service, platform-as-a-service, infrastructure-as-a-service or other similar online service that competes with TheAgentic products" | `LICENSE:1-30` | **No.** This platform is such a service |
| `anakin-master` | **AGPL-3.0** (AnakinScraper OSS, Copyright (c) 2025 Anakin.io) | `NOTICE:1-4` | **No.** Network-use clause would copyleft the product |
| `data-enrichment-js-main` *(added at Phase 1.5)* | **MIT declared in `package.json:7` only.** No LICENSE/COPYING/NOTICE file; no copyright or SPDX string anywhere in the tree (verified by `grep -ril`); source files open with unpiloted JSDoc | `package.json:7`; `find -iname` over the repo | **Pattern-level adaptation only.** Same posture as R2 for `agent-core` — see `O` §O.7, R28 |
| `ai-data-enrichment-agent-main` *(added at Phase 1.5)* | **No licence at all** — no file, no manifest (there is none), no README licence section | verified across all 5 files | **No.** Absent a licence, copyright is reserved by default. Concepts only, if even that — see R29 |

The old project reached the same conclusion and copied zero code from the latter two
(`Memory.md:56,127-128,139`). Your brief asks for anakin's job architecture and
TheAgenticBrowser's planner→browser→critique pattern. **Both are usable as design references
only** — we study the pattern and write our own implementation. `C-repository-reuse-map.md`
marks every such item `PORT (concept only, independent implementation)` and never
`DIRECT COPY`.

Two further constraints worth stating plainly:
- `@firecrawl/agent-core` is **not published to npm** (registry returns 404, verified) and the
  local snapshot has no git metadata, so it can only be vendored and cannot be diffed against
  upstream history. `UPSTREAM.md:11-13` records this.
- The TS core pins `firecrawl-aisdk@0.12.0-beta.2` — a beta dependency.

---

## 8. Environment reality check (affects the phase plan)

| Requirement | Status |
|---|---|
| Java | **21.0.8 LTS** ✅ (Spring Boot 3.x target; virtual threads available) |
| Maven | **3.9.11** ✅ |
| Node / npm | **v24.19.0 / 11.17.0** ✅ |
| MySQL | **9.6.0** installed, service `MySQL96` running, listening on 3306 + 33060 ✅ (brief asks 8+; satisfied. Note `docker-compose.yml` pins `mysql:8.4` — version drift) |
| Docker | **Not installed** ❌ — `docker` not found. Compose-based setup is unavailable; MySQL must run natively |
| Python | **3.14.6** installed at `…\Programs\Python\Python314`, `pip 26.1.2` ✅ **but** the Windows Store alias `…\WindowsApps\python.exe` precedes it on PATH, so bare `python` fails while `py` works. 3.14 is also too new for reliable wheels (pydantic-core, chromadb, numpy) — pin **3.12** for the AI service |
| Redis | Not running locally (`Memory.md:110`), and excluded by the new brief ✅ consistent |

---

## 9. Summary judgement

The old project has a **sound domain model and a real data-intelligence pipeline**, wrapped in
**a demo layer that silently replaces the product whenever a key is missing**, plus
**an authorization layer that is documented as complete but is not enforced**.

Reuse the schema, the two contracts, the quality pipeline, the governance services, the
evidence-integrity rules, the SSE/activity design, and the export writers.
Discard the demo tree, the silent fallbacks, the fabricated route-level defaults, the
hardcoded secrets and demo login, and the BullMQ/Redis layer.
Reimplement the job engine on MySQL + Spring async, taking anakin's *patterns* (not code) and
adding the two things anakin lacks: a durable claim mechanism and stale-job recovery.

One methodological lesson, from §6 rows 16–19: that project's quality claims ("213 tests pass",
"0 ESLint errors", "typechecks cleanly", "build succeeds") were written into its memory file and
never re-verified against a clean install, so a **false green baseline propagated into every
document that cited it**. FINALAIAGENT's phase exit criteria require each such claim to be a
command run in that session, with counts reported and skipped checks named (`N` §N.6).

Proceed to `A-final-architecture.md`.
