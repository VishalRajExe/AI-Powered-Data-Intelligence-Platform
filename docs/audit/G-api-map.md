# G. API Map

Two surfaces:
- **Public** — Spring Boot `/api/v1/**`, the only API the frontend may call.
- **Internal** — FastAPI `/ai/v1/**`, called only by Spring Boot over the private network,
  protected by a shared-secret API key. Never exposed to the browser.

All paths below are relative to those bases.

---

## G.1 Conventions

**Auth.** `Authorization: Bearer <accessToken>` on **every** route except `POST /auth/register`,
`POST /auth/login`, `POST /auth/refresh`, `GET /health`, `GET /ready`. This is a change from the
old project, where `app.ts:71-74` mounted only `optionalAuthenticate` and `requireWorkspaceAccess`
was never applied — leaving workspace data readable by anyone who supplied a `workspaceId`.

**Tenancy.** `workspaceId` is resolved from the authenticated principal's active membership,
**not** accepted as a client-supplied trust anchor. Where the frontend currently sends
`workspaceId`/`userId` as query params, those become optional hints validated against the token;
a mismatch returns `403 FORBIDDEN_USER_MISMATCH` (preserving the old `enforceClientIdentity`
rule, but now actually enforced).

**List envelope.**
```json
{ "data": [ … ], "pagination": { "total": 132, "page": 1, "limit": 20, "totalPages": 7 } }
```

**Error envelope.**
```json
{ "error": { "code": "REQUIREMENT_NEEDS_CLARIFICATION", "message": "…", "details": [ … ] } }
```
Messages are actionable, never stack traces (`Rules.md:46`). Secrets are masked in every error
path (port of `FirecrawlAgentAdapter.ts:403-419`).

**No fabricated fields.** Absent data is `null` or omitted. The old API invented
`confidence=90`, `sourceIds=["src-1",…]`, `progress=100|50|0`, `entity="Record"`,
`targetCount=100`. Those are gone; the frontend must render "—" instead.

**One name per concept.** `values` (not `data`), `columns` (not `fields`), `validCount` (not
`recordsValid`/`recordsAccepted`), `confidence` always 0-1. The old UI hedged across all of
these with `??` chains because the contract was unstable.

**Pagination is server-side everywhere.** The old frontend fetched `limit:100` and sliced
client-side for workflows, datasets, sources and activity.

**OpenAPI is generated** by springdoc from the controllers, not hand-written. The old
1,483-line `openapi.spec.ts` drifted from the routes.

---

## G.2 Public API — Spring Boot

### Health
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness; no auth |
| GET | `/ready` | MySQL reachable, AI service reachable, **required credentials present**. Returns 503 with the specific missing dependency. Replaces the old `/health/firecrawl`, which reported `configured:true` in demo mode (`demo-agent.adapter.ts:21-28`) and therefore lied |

### Auth
| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/auth/register` | `{email, password ≥8, name?, workspaceName?}` | 201 `{user, workspace, accessToken, refreshToken}` |
| POST | `/auth/login` | `{email, password}` | 200 same |
| POST | `/auth/refresh` | `{refreshToken}` | 200 `{accessToken, refreshToken, tokenType, expiresIn}` — rotates, revokes the old `jti` in MySQL, and **flags reuse** if a revoked `jti` is presented |
| POST | `/auth/logout` | `{refreshToken?}` | 204 |
| GET | `/auth/me` | — | `{user, workspaces[], activeWorkspace}` |

Rate limited: 15 req/min (port of `authRateLimiter`).

### Requirements
| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/requirements/parse` | `{prompt (5-4000 chars)}` | 200 `{requirement, validationStatus, warnings[], missingInformation[], ambiguities[]}` · 422 `{error.code:"REQUIREMENT_NEEDS_CLARIFICATION", details:{questions[]}}` |

Response is the **Requirement contract verbatim** (`F-workflow-model.md` §F.3). No
`entity:"Record"`, no `targetCount:100`, no synthesized `fields[]`/`filters` string. If the
model returns nothing usable, that is a 502/422 — never a default.

### Workflows
| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/workflows/plan` | `{requirement, originalPrompt?}` | 201 `{workflowId, plan, planningStatus:"PLANNED"}` · 422 if the requirement is not `valid` |
| POST | `/workflows/execute` | `{prompt}` **or** `{workflowId}` | **202** `{workflowId, runId, status:"PENDING", requirement, plan}` |
| POST | `/workflows/{id}/run` | — | 202 `{runId, status}` — re-run a saved plan |
| GET | `/workflows` | `?page&limit≤100&search&status` | paginated; each item carries **real** `progress`, `displayStatus`, `lastRun` summary |
| GET | `/workflows/{id}` | — | workflow + enriched `lastRun` |
| GET | `/workflows/{id}/runs` | `?page&limit` | paginated run history |
| DELETE | `/workflows/{id}` | — | 204; cascades runs/datasets |

`/workflows/execute` performs parse → plan → persist → enqueue and returns 202 immediately. No
long work on the request thread (`Rules.md:30`).

### Runs
| Method | Path | Response |
|---|---|---|
| GET | `/runs/{id}` | `{status, progress, stage, counters{recordsRaw, recordsFound, validCount, duplicateCount, sourcesProcessed, sourcesFailed}, datasetId?, errorCode?, errorMessage?, startedAt?, finishedAt?}` |
| GET | `/runs/{id}/steps` | `{steps[]}` in sequence order, each with type, status, attempt, durationMs, sourceIds, error |
| GET | `/runs/{id}/activity` | `{events[]}` from `activity_events`, each with `action`, **`message`** (server-composed — the UI currently synthesizes it), `timestamp`, `details` |
| POST | `/runs/{id}/cancel` | 202 `{status, cancelRequested:true}` |
| GET | `/runs/{id}/events` | **SSE** (see G.4) |

`progress` and `stage` are **authoritative**, computed from persisted step state. The frontend
must stop computing `(idx+1)/stages.length*100` (`live/page.tsx:102`).

### Datasets
| Method | Path | Query | Notes |
|---|---|---|---|
| GET | `/datasets` | `?page&limit≤200&sort&order&search` | search spans name, description and the originating requirement |
| GET | `/datasets/{id}` | — | metadata + `columns[]` |
| DELETE | `/datasets/{id}` | — | 204 |
| GET | `/datasets/{id}/schema` | — | `columns[]`: key, label, type, position, required, filterable, sortable |
| GET | `/datasets/{id}/rows` | `?page&limit&search&sortField&sortOrder&validOnly&includeDuplicates&verificationStatus&confidenceMin&confidenceMax&sourceId&filter[<key>]=<value>` | filter/sort keys are **validated against `dataset_columns`** before touching SQL — this is the JSON-path-injection defence carried over from `Memory.md:59`. Text search uses the `search_text` FULLTEXT index, not `LIKE '%…%'` over JSON |
| GET | `/datasets/{id}/rows/{rowId}` | — | row + `values` + `rawValues` + `qualityMetadata` + `conflicts` |
| GET | `/datasets/{id}/rows/{rowId}/evidence` | — | per-field evidence with snippets and `isVerified` |
| GET | `/rows/{rowId}/evidence` | — | top-level alias |
| GET | `/datasets/{id}/sources` | `?page&limit` | sources for that dataset's run |

> The old `GET /api/v1/rows/:id/evidence` called `getRowEvidence(workspaceId, id, userId)` with
> 3 args where the signature elsewhere took 4 `(workspaceId, datasetId, rowId, userId)`
> (`datasets.routes.ts:308`). In the new API the top-level alias takes **only** `rowId`, resolved
> through the authenticated workspace, so the arity bug cannot recur.

### Sources (new — kills the N+1)
| Method | Path | Notes |
|---|---|---|
| GET | `/sources` | `?page&limit&status&domain&runId&search` — **workspace-global**. The current UI has no such endpoint, so `sources/page.tsx:51-78` fetches every dataset's sources at `limit=100` and dedupes in a client `Map` |
| GET | `/sources/{id}` | full lifecycle: status, policyReason, robotsStatus, relevanceScore, attemptCount, verifiedByTool, retrievedAt, errorCode |

### Aggregates (new)
| Method | Path | Notes |
|---|---|---|
| GET | `/stats` | **True workspace totals**: workflowCount, runCount by status, datasetCount, recordCount, validCount, sourceCount, sourcesBlocked, sourcesFailed, lastRunAt. Replaces `dashboard/page.tsx:75-78`, which summed only the first 10 datasets and presented the result as a total |
| GET | `/activity` | `?page&limit&runId&action` — workspace-global feed. Replaces the sequential per-run loop in `activity/page.tsx:129-157` |

### Exports
| Method | Path | Request / Response |
|---|---|---|
| POST | `/datasets/{id}/exports` | `{format: CSV\|JSON\|XLSX, columns[]?, filterDefinition{search, validOnly, includeDuplicates, verificationStatus, confidenceMin/Max, fieldFilters, sort}, waitForCompletion?}` → **202** `{exportId, status:"PENDING"}` |
| GET | `/exports/{id}` | `{status, fileMetadata{fileName,fileSize,rowCount,columnCount,contentType,checksumSha256}, errorCode?, expiresAt?}` |
| GET | `/exports/{id}/download` | streams with `Content-Disposition`; path-traversal contained to the storage dir (port of `export.repository.ts:122-128`) |

Exports are **queued jobs with a lease and a recovery sweeper**, not in-process promises
(the old `export.service.ts:41-53` stranded jobs in `RUNNING` on restart and never enforced its
own `EXPIRED` status).

### Preferences (new — the settings page currently saves nothing)
| Method | Path | Notes |
|---|---|---|
| GET | `/preferences` | `{theme, defaultSourceCap, autoDedupe, defaultExportFormat, …}` from `user_preferences` |
| PUT | `/preferences` | persists; 200 with the stored value |

### Docs
| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/openapi.json` | generated |
| GET | `/swagger-ui.html` | generated |

---

## G.3 Internal API — FastAPI (Spring → Python only)

Authenticated with a shared secret (`AI_SERVICE_API_KEY`) accepted as `X-API-Key`, compared in
constant time. Bound to localhost / the internal network. Never proxied by Next.js.

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/ai/v1/requirements/parse` | `{prompt, options?}` | `{requirement, validationStatus, ambiguities[], missingInformation[], warnings[], usage{model, tokens, durationMs}}` |
| POST | `/ai/v1/workflows/plan` | `{requirement, originalPrompt, previousIssues[]?}` | `{plan, usage}` — `previousIssues` drives the single correction retry |
| POST | `/ai/v1/collect/search` | `{queries[], limit, blockedDomains[], preferredDomains[]}` | `{candidates[{url, title, snippet, query}]}` — **raw candidates only**; Java governs them |
| POST | `/ai/v1/collect/extract` | `{targets[{url, markdown?}], extractionSchema, objective, requiredFields[], allowedTools[], maxItems, stepBudget}` | `{records[{values, rawValues?, sourceUrls[], observedSourceUrls[]}], sources[{url, canonicalUrl, domain, title?, snippet?, sourceType, retrievedAt, verifiedByTool}], schemaMismatch?, execution{provider, model, durationMs, tokens, toolCallCount, toolsUsed}, errors[]}` |
| POST | `/ai/v1/quality/process` | `{records[], columns[], requirement, plan{transformations, validationRules, deduplicationRules}, existingKeys?}` | `{records[{values, rawValues, isValid, validationIssues[], confidence?, verificationStatus, duplicateOfKey?, conflicts[]}], metrics{raw, normalized, valid, invalid, duplicate, reviewRequired, conflict, sourceBacked, qualityScore, meanConfidence}}` |
| POST | `/ai/v1/verify` | `{objective, completionCriteria, records[], metrics, stepTrace}` | `{feedback, terminate, finalResponse?, decision: advance\|retry-step\|replan\|terminate}` |
| GET | `/ai/v1/health` | — | `{status, firecrawlConfigured, llmConfigured}` — **reports the truth**; a missing key yields `configured:false`, never a demo `true` |

Design rules:
- **Stateless.** No DB access, no job table, no sessions. Nothing to lose on restart, which is
  what makes the no-Redis constraint safe.
- **Python's quality output is advisory.** Java re-enforces the contract (required fields,
  types, evidence presence) before persisting. Python proposes, Java disposes.
- **Governance stays in Java.** Python receives only URLs Java has already cleared, and returns
  `observedSourceUrls` so Java can apply the tool-observed-evidence rule. Python cannot widen
  its own scope.
- `allowedTools` is derived from the validated plan and enforced by an allowlist in the
  Firecrawl wrapper (port of `FirecrawlAgentAdapter.ts:168-177`).

---

## G.4 SSE contract — `GET /api/v1/runs/{id}/events`

Standard `EventSource` wire format. On connect: replay `activity_events` for the run honouring
`Last-Event-ID` (bounded, e.g. last 500), then stream live, `: ping` comment heartbeat every
15s, and close on a terminal status.

```
id: 1042
event: SOURCE_DISCOVERED
data: {"runId":"…","action":"SOURCE_DISCOVERED","message":"Discovered 12 candidate sources",
       "timestamp":"2026-09-28T22:41:07.812Z","details":{"count":12}}
```

**Event vocabulary — one canonical name each.** The current UI switches on 15 names and hedges
between two spellings of one event (`use-sse.ts:121-134`), because the backend emitted
`DEDUPLICATION_COMPLETED` while the UI also listened for `DEDUP_COMPLETED`. The new backend
emits exactly this list and the UI hedge is deleted:

`STAGE_STARTED`, `STAGE_COMPLETED`, `SOURCE_DISCOVERY_STARTED`, `SOURCE_DISCOVERED`,
`SCRAPE_STARTED`, `SCRAPE_COMPLETED`, `SOURCE_PROCESSED`, `SOURCE_FAILED`,
`EXTRACTION_STARTED`, `RECORDS_EXTRACTED`, `VALIDATION_COMPLETED`, `DEDUPLICATION_COMPLETED`,
`DATASET_CREATED`, `RUN_COMPLETED`, `RUN_FAILED`, `RUN_CANCELLED`.

`RECORDS_COLLECTED` is dropped as a synonym of `RECORDS_EXTRACTED`. Terminal trio closes the
stream.

**Auth for SSE.** The current implementation passes the JWT as a query parameter
(`use-sse.ts:87-88,93`), which leaks it into proxy logs, browser history and access logs.
Replace with a **short-lived single-use stream ticket**: `POST /runs/{id}/stream-ticket`
(authenticated) returns a token valid for ~60s and one connection; the SSE URL carries that
ticket instead of the JWT.

**Fan-out constraint.** Without Redis pub/sub, live events reach a browser only if the emitter
registry is in the same JVM as the worker. v1 is therefore single-node (`A` §A.4). Events are
durable in `activity_events` regardless, so reconnect/replay is always correct; and TanStack
Query polling of `GET /runs/{id}` is the documented fallback if SSE is unavailable.

---

## G.5 Frontend → endpoint mapping

| Screen | Endpoints |
|---|---|
| Login / Register | `POST /auth/login`, `POST /auth/register`, `GET /auth/me` |
| Dashboard | `GET /stats`, `GET /workflows?limit=5`, `GET /datasets?limit=5` |
| New Research | `POST /requirements/parse` |
| Workflow Preview | `POST /workflows/plan` — renders the **actual returned DAG**, not a static 7-step list |
| Workflow Running | `POST /workflows/execute` → `GET /runs/{id}` + `GET /runs/{id}/events` (SSE) + `POST /runs/{id}/cancel` |
| Workflow History | `GET /workflows`, `GET /workflows/{id}`, `GET /runs/{id}/steps`, `GET /runs/{id}/activity` |
| Dataset Explorer | `GET /datasets`, `GET /datasets/{id}`, `GET /datasets/{id}/schema`, `GET /datasets/{id}/rows` |
| Source Explorer | `GET /sources` (global), `GET /datasets/{id}/sources`, `GET /sources/{id}`, `GET /rows/{id}/evidence` |
| Activity Log | `GET /activity` (global) |
| Export | `POST /datasets/{id}/exports`, `GET /exports/{id}`, `GET /exports/{id}/download` |
| Settings | `GET /auth/me`, `GET /preferences`, `PUT /preferences` |

All 23 endpoints the current UI already consumes are preserved; 5 are new (`/stats`,
`/sources`, `/sources/{id}` global form, `/activity`, `/preferences`) and exist specifically to
remove client-side aggregation, N+1 fetch loops, and the fake settings page.

Next: `H-ai-service-design.md`.
