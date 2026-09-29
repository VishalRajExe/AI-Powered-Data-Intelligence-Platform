# Memory.md — Living Project Memory

### Project: FINALAIAGENT — AI-Powered Data Intelligence Platform

This file records **verified** state only. Every "works" claim must name the test or command that
proved it. Anything skipped, unverified or assumed is recorded in §5, not omitted. This discipline
exists because the previous project's memory file claimed authorization was active, that no `.env`
existed, and that the system was production-ready — each contradicted by its own source
(see `docs/audit/00-FORENSIC-AUDIT.md` §2, §3).

---

## 1. Current Status

- **Current Phase:** 5 — research quality integration. **COMPLETE, live-verified by nothing**
  (see §2 and §5): every case ran on doubles, because there is still no `FIRECRAWL_API_KEY`.
  Requirement → search strategy → relevant sources → source policy → Firecrawl → extraction is
  now one connected path over one web engine. Phases 0-4 are recorded above; nothing is persisted.
- **Last updated:** 2026-09-29
- **Application code written:** three independent processes.
  - `backend/` — Spring Boot 3.5.16, Java 21, Maven. 25 main source files, 11 test classes.
  - `ai-service/` — FastAPI on Python 3.14 (3.12 pinned for deployment), 36 modules: config,
    contracts, security, logging, `api/v1/{health,research,requirements}`, `llm/`, `firecrawl/`,
    `extraction/`, `requirements/`, `research/` (graph, tools, state, prompts, skills, contracts)
    and `curation/` (canonical, relevance, ranking, policy, robots, retry, queries, aggregation).
  - `frontend/` — Next.js 14.2.35. PirateAgentUI design foundation copied byte-identically
    (`diff -r` verified), 10 routes, `lib/api/` typed client.
  - Plus `database/`, `deploy/`, `scripts/`, `ai-service/skills/` (playbook loader docs), and the
    root `.env.example`.
- **Runnable:** yes. `scripts/dev-backend.sh`, `dev-ai.sh`, `dev-frontend.sh` each start one
  process; `scripts/verify.sh` runs every suite.
- **Still not built:** the workflow planner and job engine, the MySQL schema and persistence, the
  quality pipeline (normalize / validate / dedupe / entity-resolve), host-resolution source
  governance (SSRF and per-domain rate — robots *is* now enforced at fetch time), SSE monitoring,
  exports, and authentication. `POST /api/v1/research` runs the graph and returns the result,
  storing nothing.
- **Repository:** `FINALAIAGENT` is its own git repo, pushed to branch `implementjava` of
  `github.com/VishalRajExe/AI-Powered-Data-Intelligence-Platform.git` after every phase, per the
  standing rule. Its history is independent of `main` (old project), which has never been touched
  from here. Phase 5 is the next commit to make.
- **Blocked on:** decisions **G1**, **G2**, **S1** and the **L1** licence ruling (§6); a MySQL
  account the app can connect as; Python 3.12 before the provider extra is installed.

## 2. Completed Phases

- [x] **Phase 0 — Forensic audit.** Full source inspection of the old project (backend,
      PirateAgentUI, control docs) and all four reference repositories. Produced
      `docs/audit/00-FORENSIC-AUDIT.md` plus deliverables A-M.
- [x] **Phase 0 extension (2026-09-29) — toolchain forensics and reuse-map reformat.**
  - Added `docs/audit/N-scripts-and-dependencies.md`: the old project's scripts and dependencies
    were **executed**, not read. Result: typecheck, both lint gates and the test suite all fail in
    the current checkout (§5 items 15–18).
  - Reformatted `docs/audit/C-repository-reuse-map.md` from 4 columns to the required 6:
    repository → useful feature → source path → **actual implementation** → reuse method →
    destination. All ~90 rows preserved; "actual implementation" now separates verified behaviour
    from what the docs claim, and defects are marked inline.
- [x] **Phase 1 (2026-09-29) — Foundation & skeleton.** Three processes built, started, and tested.
  Every number below came from a command run in this session.

  | Verification | Measured |
  |---|---|
  | `mvn test` | **27 passed**, 0 failures, 0 skipped |
  | `mvn package` | fat jar 28.9 MB, `java -jar` boots in ~3 s |
  | Backend without credentials | **exit 1**, naming `AI_SERVICE_API_KEY`, `MYSQL_PASSWORD`, `MYSQL_USER`; values never printed |
  | `pytest` | **31 passed** |
  | AI service without `FIRECRAWL_API_KEY` | **exit 1**, naming the variable |
  | `AI_SERVICE_API_KEY` mismatch | **401 UNAUTHENTICATED** on `/ai/v1/ready`; 200 with the key |
  | `npm run typecheck` / `lint` / `build` | all pass; 13 pages generated |
  | Next dev proxy → Spring → FastAPI | one `curl` returned `aiService: UP` inside the backend's `/ready` |
  | `/actuator/health/liveness` with MySQL down | `UP` (containers will not restart-loop) |
  | `/api/v1/ready` overall | **503, honestly** — `mysql: DOWN` because no matching database user exists |

  Design foundation integrity: `diff -r` against `PirateAgentUI` confirms every copied CSS,
  config, and component file is byte-identical; `grep` for `localStorage|NEXT_PUBLIC|AIza|fc-`
  across `app/ components/ lib/ hooks/` returns only explanatory comments.

- [x] **Phase 1.5 (2026-09-29) — integration analysis of two new reference repositories.**
  Read-only: no code written, no Phase 2 work started, no frontend modified, nothing deleted.
  Produced `docs/audit/O-new-repositories-integration-analysis.md` (answers the required A–K),
  plus `C` §C.7 and the licence rows in `00` §7.
  - `data-enrichment-js-main` — 691 lines of TypeScript. A real plan → act → **critique** → re-loop
    graph, an enforced turn bound, configurable limits, and **zero hardcoded field names in
    `src/`**, which structurally corroborates our "prompt determines the schema" requirement.
    One idea adopted: the completeness critique as extraction **gate 3**, with three of its defects
    fixed (`O` §O.4).
  - `ai-data-enrichment-agent-main` — 166 lines, one file, no validation, no loop bound, no tests,
    and **no licence anywhere**. Contributes nothing FINALAIAGENT does not already have in stronger
    form. Its README promises "Returns structured JSON matching your schema"; the code never checks
    the schema.
  - **Bright Data and Tavily are both rejected.** Bright Data's own comment calls its unlocker a
    tool for *"bypassing anti-bot protection"* (`enrichment_agent.py:40`), contradicting our
    Java-fixed `allowCaptchaBypass=false` / `respectRobotsTxt=true`. Firecrawl stays the sole engine.
  - **Three-runtime architecture stands.** Nothing in the JS graph needs the LangGraph runtime:
    `compile()` has no checkpointer, nothing touches disk, and the nodes are a plain loop over a
    message list with an integer counter. Answer to "what stays in TypeScript": **nothing**.
  - Bugs recorded as not-to-copy: the turn bound guards **only the critique exit path**, so a run
    that keeps calling search never hits it; loop exhaustion ends the run as if it succeeded;
    `maxInfoToolCalls` is declared and defaulted but **never read** (same dead-config class as
    anakin's `MAX_JOB_RETRIES`); prompts advertise `Search`/`ScrapeWebsite` while the registered
    tools are named differently; `.replace(str, str)` corrupts prompts containing `$&` or `$1`;
    `lint:all` joins steps with `&` so lint failure cannot fail CI; and `fetch` is called without
    ever checking `response.ok`, letting a bot-block page become cited "evidence".
  - **Licence exposure is now unresolved on two repos** (R28, R29). `data-enrichment-js` claims MIT
    in `package.json:7` with no licence text anywhere in the tree; `ai-data-enrichment-agent` has
    none at all. See §6 gate **L1**.

- [x] **Phase 2 (2026-09-29) — data-enrichment core integration.** `data-enrichment-js`'s research
  graph is now the inner loop of this project's extraction step, re-implemented in Python against
  Firecrawl. No reference repository is a build or runtime dependency.

  | New | Purpose |
  |---|---|
  | `ai-service/app/research/{state,tools,prompts,graph,contracts}.py` + `prompts/*.md` | the bounded research graph: `plan_action → run_tools → submit_extraction → critique`, with the ported topology and bounds on every path |
  | `ai-service/app/extraction/schema_validate.py` | gate 1, ported from `schema-validate.ts`, one validator backing checklist, gate and assessment |
  | `ai-service/app/llm/client.py` | Gemini structured output; `RecordingLlm` double |
  | `ai-service/app/firecrawl/client.py` | sole web engine; async SDK; `FakeWeb` double |
  | `POST /ai/v1/research` (key-gated) | requirement + dynamic schema → records, sources, metadata, validation |
  | `backend/.../research/ResearchController.java`, `aiclient/dto/Research{Request,Result}.java` | Spring passthrough with independent schema validation and upstream error mapping |
  | `docs/control/THIRD-PARTY.md` | provenance and licence position for every ported item |

  Measured, all run in this session: **`pytest` 74 passed**, **`mvn test` 37 passed**, live chain
  verified — a payload valid for Java but invalid for Python came back `422
  AI_SERVICE_REJECTED_REQUEST` carrying Python's own envelope, and an empty schema was rejected by
  Java with `verifyNoInteractions` proving Python was never called.

  **Decision L2 resolved: no LangGraph dependency.** The graph is a plain Python state machine
  because nothing in the template needs the runtime (`compile()` takes no checkpointer, `src/`
  writes nothing to disk, nodes reduce to a loop over a message list with a counter). The node and
  edge names are preserved and declared on `ResearchGraph.NODES` / `EDGES`, so the architecture is
  inspectable and swapping in `langgraph` later stays mechanical.

  **SDK facts corrected by introspection** (Phase 0 had partly guessed, and the code disagrees with
  the docs — worth keeping because later phases depend on it):
  - `from firecrawl import Firecrawl / AsyncFirecrawl` exposes **only** paper/parse methods. The
    verbs live on `FirecrawlApp` / `AsyncFirecrawlApp`.
  - `AsyncFirecrawlApp.interact(job_id, code=…, prompt=…, language=…)` takes a **job id, not a URL**
    — a browser session must exist first. This narrows what G2 can conclude.
  - `search` returns `SearchData` with results under `.web`; `scrape` returns `ScrapeData` with
    `.markdown` and `.metadata`. Normalizers read both attribute and dict shapes.
  - `google-genai` 1.75.0 and `firecrawl` 4.45.0 both install on **Python 3.14** (cp314 wheels
    present for the aiohttp stack), so the "3.12 required" constraint applies to reliability, not to
    installability of these two.

  Bugs found and fixed while building it:
  1. `app/contracts.py` — the file inherited from before Phase 1 — **could not be imported at all**:
     a missing `and` in a boolean chain at line 130 was a `SyntaxError`. It had never been executed
     or tested, which is exactly why Phase 1 recorded it as unverified rather than claiming it worked.
  2. My port of the schema validator let an **empty array pass validation** — a model returning
     `{"records": []}` would have looked schema-valid. A test caught it; `[]` is now missing, as
     upstream treats it.
  3. `prompts.render` had `split(...).join(value)` inverted, raising `AttributeError` on every
     prompt — the "literal substitution" I wrote was not valid Python.
  4. Two test assertions were wrong about their own intent (a domain-policy case compared
     `youtube.test` against an allow-list of `youtube.com`; a truncation case expected the budget to
     cover the truncation marker). Corrected rather than the code bent to fit them.

  **Not done, stated plainly:** no live provider run. There is no `FIRECRAWL_API_KEY` on this
  machine, and a real Gemini call would bill the developer's account without being asked for. The
  graph is therefore verified against doubles only; `tests/test_live_provider_spike.py` exists and
  is skipped unless `RUN_LIVE_PROVIDER_TESTS=true`. Persistence is also absent: `POST
  /api/v1/research` returns the run and stores nothing, because there is still no schema.
  Risk **R32** records that the graph lets the model name URLs while robots/SSRF gating arrives with
  the source-governance phase.

- [x] **Phase 3 (2026-09-29) — dynamic data contract + extraction schema.** Natural language now
  drives the field list: prompt → AI requirement → data contract → extraction schema → research
  graph, with Spring validating the AI's answer between stages.

  | New | Purpose |
  |---|---|
  | `ai-service/app/requirements/{schema,service}.py` + `prompts/requirement.md` | Gemini structured output into the existing `Requirement` contract, bounded repair, fail-closed |
  | `derive_extraction_schema()` | builds the graph's JSON Schema from the requirement's own fields — no template |
  | `build_research_brief()` | geography, dates, filters, quantity and source wishes become collection constraints |
  | `POST /ai/v1/requirements/analyze`, `POST /ai/v1/research/from-prompt` | the stages, and the whole flow |
  | `backend/.../requirement/{RequirementDto,RequirementValidator,PipelineController}.java` | Java's independent validation gate; collection is blocked unless it passes |
  | `ai-service/tests/test_live_requirements.py` | gated live check that the three brief prompts yield three distinct schemas |

  Measured: **98 pytest passed (4 gated-live skipped)**, **54 mvn tests passed**, frontend
  typecheck/lint/build unchanged and passing.

  Three defects found and fixed by actually running the live path:
  1. `GeminiLlm` passed OpenAI-shaped `[{"role","content"}]` dicts where the SDK wants a string
     or `types.Content` — pydantic rejected every request.
  2. Gemini's `responseSchema` has **no `additionalProperties` field** and returns
     `400 INVALID_ARGUMENT`. Since gate 1 depends on `additionalProperties: false`, the two are
     reconciled by `to_gemini_schema()`: the strict schema stays the internal contract and only
     the provider copy is projected. `strip_const` alone was not enough.
  3. `tests/conftest.py` assigned `os.environ[key] = value`, overwriting the developer's real
     `GEMINI_API_KEY` with a dummy — so the live test reported "API key not valid". Now
     `setdefault`.

  Also measured about my own code: masking provider errors to a bare type name made the first
  failure undebuggable, so `_detail()` now truncates to 400 chars and redacts the key if it
  appears — diagnosable without becoming a leak. Unit-tested.

  **One thing NOT verified, stated plainly:** the live three-prompt schema comparison did not
  complete. The account is on the **Gemini free tier**, capped at **20 `gemini-2.5-flash`
  requests/day**, which was exhausted mid-run (`429 RESOURCE_EXHAUSTED`). The requests were
  reaching the API correctly by then. The dynamic-derivation *logic* is proven offline
  (`test_the_three_requests_yield_three_distinct_schemas`, plus per-request schema assertions);
  what remains unproven is that Gemini itself returns genuinely different field sets for the
  three prompts. Re-run after the quota resets or on a paid key:
  `RUN_LIVE_PROVIDER_TESTS=true pytest -q tests/test_live_requirements.py -s`.

  Deferred deliberately: no 429/backoff handling for provider rate limits yet (the error is
  surfaced, not retried), and no requirement persistence — there is still no schema to store
  a contract in, so `/api/v1/requirements/parse` is stateless.

- [x] **Phase 4 (2026-09-29) — Firecrawl web execution inside the research graph.** The graph now
  runs the three Firecrawl tools it needs — `search`, `scrape`, `interact` — through one seam, with
  a browser-session lifecycle, a per-run tool allowlist, and site playbooks. **No second Firecrawl
  system was created and no fourth runtime was added.**

  | New / changed | Purpose |
  |---|---|
  | `app/firecrawl/client.py` `Interaction`, `strip_interact_nulls()`, `interact_timeout_message()`, `normalize_interact()`, `FirecrawlWeb.interact()` | one browser session per call: `browser()` → `interact(prompt=…)` → `stop_interaction()` in a `finally`; a deadline that returns a structured envelope instead of hanging the loop |
  | `supports_interact()` + `InteractiveWebTool` / `FakeInteractiveWeb` | browser capability is an optional contract, so "this engine cannot run sessions" is a tested state, not a crash |
  | `ResearchLimits.allowed_tools`, `max_interactions_per_run`; `StepBudget.interaction_allowed()` | the tool set and the session budget are per-run, bounded, and checked before every call |
  | `prompts.action_schema(allowed_tools)`, `actions_help()`, `allowed_data_tools()` | the plan-action schema is **generated per run** from the enabled tools; a disabled tool is not in the enum, so the provider cannot ask for it |
  | `tools.run_interact()`, refusal in `execute_many()` | interact requires an enabled tool, a capable engine, a URL already retrieved this run, and budget; it is refused in parallel batch execution |
  | `app/research/skills.py` + `ai-service/skills/README.md` + `SKILLS_DIR` | `SKILL.md` frontmatter parse/validate, discovery, domain index, URL→playbook match, traversal-guarded resource read; injected into the plan turn deterministically |
  | `Settings.allowed_web_tools` (ceiling), `search_timeout_seconds`, `max_interact_concurrency`, `skills_dir` | operator-side control; a request can narrow the ceiling but never widen it |
  | `POST /ai/v1/research` → `resolve_limits()` | intersects request with ceiling, clamps the session budget, returns **400 `NO_PERMITTED_WEB_TOOLS`** instead of starting a run that can only report `blocked` |
  | `backend/.../research/WebToolPolicy.java` + DTO fields `allowedTools`, `maxInteractionsPerRun` | Java rejects unknown tool names, an empty list, an out-of-range budget, and a session budget for a run that did not request `interact` — before a round trip |
  | `/ai/v1/ready` `web` + `skills` blocks | which tools are enabled, whether the attached engine supports interact, how many playbooks loaded and how many were rejected |
  | `tests/test_firecrawl_interact.py` (19), `tests/test_research_interact.py` (18), `tests/test_skills.py` (24), `tests/test_live_firecrawl.py` (3, gated), `WebToolPolicyTest` (11) | coverage for the lifecycle, the gates, the loader and the wire contract |

  Measured with `scripts/verify.sh`: **backend 68 mvn tests passed** (was 54), `mvn package` ok,
  **ai-service 174 pytest passed, 7 skipped** (was 98 passed / 4 skipped). 79 cases added: 19 web
  lifecycle (`test_firecrawl_interact`), 18 graph interact (`test_research_interact`), 24 skills
  (`test_skills`), 8 API ceiling/clamp, 7 config, and 3 gated live cases that skip. Frontend
  typecheck, lint and build unchanged and passing.

  Reuse records, in the required format:

  | Repository | Source file | Feature | Destination | Method |
  |---|---|---|---|---|
  | web-agent-main | `agent-core/src/toolkit.ts:25-34` | `stripInteractNulls` — drop null/empty interact fields, keep empty arrays | `app/firecrawl/client.py::strip_interact_nulls` | PORT (behaviour), rewritten in Python, comment records why |
  | web-agent-main | `agent-core/src/toolkit.ts:51-102` | interact hard timeout + structured `{error,timedOut,url,prompt}` envelope with fallback advice | `FirecrawlWeb.interact`, `interact_timeout_message` | PORT + IMPROVE — ours also stops the session (`finally`), upstream leaves it to the TTL |
  | web-agent-main | `agent-core/src/toolkit.ts:188-204` | `createFiltered(enabled)` — build the agent's tool set from an allowlist | `prompts.allowed_data_tools` + `action_schema()` + `Settings.allowed_web_tools` | PORT (concept), inverted: the ceiling is server config, the request may only narrow |
  | web-agent-main | `agent-core/src/worker/index.ts:61,69` | workers get search+scrape only, never a browser session | `tools.execute_many()` refusal | PORT (rule) as a hard refusal, not a prompt request |
  | web-agent-main | `agent-core/src/agent.ts:34-39,72-88` | `DATA_TOOLS` includes `interact` as evidence; `resultHasData` treats `{error}` as no data | `ResearchState.has_tool_data()` + `ToolOutcome.ok` | ALREADY PRESENT — the ported gate covers it; verified by test |
  | web-agent-main | `agent-core/src/skills/parser.ts` | frontmatter fields, slug rule, `validateSkillContent` (name+description+non-empty body) | `app/research/skills.py` | PORT, no `gray-matter`/YAML dependency — strict-subset parser |
  | web-agent-main | `agent-core/src/skills/discovery.ts` | `<dir>/<skill>/SKILL.md` walk, `sites/*.md` playbooks, resource listing | `discover_skills()` | PORT + IMPROVE — upstream swallows invalid skills silently; ours returns `rejected` reasons |
  | web-agent-main | `agent-core/src/skills/tools.ts:66-92` | URL→domain match: exact, `www.`-stripped, suffix | `domain_of()`, `lookup_playbook()` | PORT |
  | web-agent-main | `agent-core/src/skills/tools.ts:107-110` | `path.resolve` + `startsWith` traversal guard | `SkillLibrary.read_resource()` | PORT + STRICTER — resolved-`Path` ancestry, absolute paths refused outright |
  | web-agent-main | `agent-core/src/firecrawl-tools.ts` | Firecrawl tools come from `firecrawl-aisdk` (npm) | — | REJECTED — Node-only package; the Python SDK exposes the same endpoints (see §3, 2026-09-28) |
  | web-agent-main | `agent-core/skills/definitions/**` | six authored SKILL.md playbooks | — | NOT COPIED — content is domain-specific to its demos; ships zero playbooks |
  | web-agent-main | `agent-core/src/orchestrator/sub-agents.ts`, `worker/index.ts` | sub-agent spawn / parallel worker fan-out | — | DEFERRED to the Spring plan-DAG phase; two orchestrators was ruled out in Phase 0 |

  Defect found and fixed by running the code rather than reading it: `FirecrawlWeb.search()` was
  passing `interact_timeout_seconds` as its deadline. Search had the browser session's timeout and
  `SEARCH_TIMEOUT_SECONDS` did not exist. Now `search_timeout_seconds` (30 s) with its own validation
  and a regression test.

  **Not verified, stated plainly:** *"Test real and mocked Firecrawl execution"* — only the mocked
  half was possible. `FIRECRAWL_API_KEY` is blank in both the shell and the root `.env` (measured:
  length 0), so `tests/test_live_firecrawl.py` skips its three cases. The browser-session path is
  therefore verified against **a stub of the SDK client**, which does prove our own lifecycle,
  timeout and normalisation code, but proves nothing about Firecrawl's live behaviour: whether a
  prompt-mode session answers, how long it takes, what it costs, and whether `interact` is
  sufficient at all (decision **G2** stays open for exactly this reason). Also unverified: real
  SKILL.md content — none ships, so the loader is exercised only on test fixtures.

  Deliberately not built in this phase: `map`, `crawl`, `extract`, `bash`/`scrapeBash` (the SDK
  exposes them; the graph's budget model is page-evidence shaped and a crawl would outrun it),
  per-URL robots/SSRF clearing (Spring's source-governance phase), and provider backoff.

- [x] **Phase 5 (2026-09-29) — research quality integration.** The run now goes
  requirement → search strategy → relevant sources → source policy → Firecrawl → extraction.
  One search system (Firecrawl), one policy path, and every excluded source carries a reason.

  | New / changed | Purpose |
  |---|---|
  | `app/curation/canonical.py` | URL page-identity: fragment, campaign params, `www.`, default port, insignificant trailing slash collapsed; scheme preserved, meaningful params sorted |
  | `app/curation/relevance.py` | lexical scoring of a Firecrawl result against vocabulary derived from **that request** (objective, entity type, schema field names/descriptions) plus the request's own preferred domains |
  | `app/curation/ranking.py` | score → drop duplicates → optional floor → per-domain diversity → top-N, deterministically ordered; every drop keeps a code and a reason |
  | `app/curation/policy.py` | `SourcePolicy` — domain allow/block and robots in one decision path; `domain_allowed` moved here from `research/tools.py`; `extract_hostnames()` turns prose source wishes into hosts *or* notes |
  | `app/curation/robots.py` | `HttpRobots`: one `robots.txt` per origin per run, stdlib fetch, bounded timeout, RFC-9309 status handling, `restrict`/`allow` on unreadable; `StaticRobots` double for tests |
  | `app/curation/retry.py` | classification (`TIMEOUT`/`RATE_LIMIT`/`TRANSIENT_NETWORK`/`SERVER_ERROR`/`PERMANENT`), capped jittered backoff, bounded attempts — driven by `RetryPolicy`, which had existed since Phase 0 unused |
  | `app/curation/queries.py` | `SearchStrategy` built for real: deduplicated, budget-fitted query plan |
  | `app/curation/aggregation.py` | first-observed source order, per-source citation counts, records with no retrieved citation flagged and kept |
  | `FirecrawlWeb` | retry on reads only, `WebError.kind`, `search`/`scrape`/`interact` deadlines separated, `retry_attempts` counter, `sleeper` seam |
  | `research/{state,tools,graph}.py` | per-run policy + target; ranked search output shown to the model; canonical duplicate refusal; robots gate before scrape and before session; refusal/drop accounting in metadata and validation |
  | `app/research/prompts/research.md` | **the planning turn now contains what has been retrieved** (see P9) |
  | `/ai/v1/ready` `curation` block, `resolve_limits()`, `ResearchLimitsRequest` | the knobs and the request fields, ceiling-clamped |
  | `backend/.../research/SourceCurationPolicy.java` + `WebToolPolicy` + DTO fields | Java refuses an unusable shape (impossible floor, prose "hostname", blank entity type, over-large caps) before a round trip |

  Measured with `scripts/verify.sh`: **backend 80 mvn tests passed** (was 68), `mvn package` ok,
  **ai-service 242 pytest passed, 8 skipped** (was 174/7). 68 cases added: 42 in
  `test_curation.py`, 12 in `test_curation_pipeline.py`, 7 in `test_canonical_urls.py`, 7 config
  assertions; plus one gated live robots case that skips here. Frontend typecheck, lint and build
  unchanged and passing. **No new dependency was added** — robots fetching is stdlib `urllib` on a
  worker thread, and nothing from `web-research-agent-master` (`chromadb`, `httpx`, `numpy`,
  BeautifulSoup, LangChain) is installed or imported.

  Reuse records:

  | Repository | Source file | Feature | Destination | Method |
  |---|---|---|---|---|
  | web-research-agent-master | `utils/get_relevant_urls.py:3-24` | score every result, dedupe, sort, take top M | `curation/relevance.py`, `curation/ranking.py` | **PORT (concept), different mechanism** — cosine over Azure snippet embeddings replaced by saturating lexical scoring; threshold added (upstream computed scores and never used them as a decision) |
  | web-research-agent-master | `utils/web_scraper.py:18-31` | robots.txt gate wired into the fetch path | `curation/robots.py`, `curation/policy.py` | **PORT + FIX** — per-origin cache (upstream: one GET per URL), our own UA token (upstream: literal `*`), status-aware (upstream: parsed a 500 HTML page as "no rules" and allowed), refusal reported (upstream: log and skip) |
  | web-research-agent-master | `utils/web_scraper.py:33-45` | exponential backoff | `curation/retry.py`, `FirecrawlWeb._call` | **PORT + FIX** — cap and jitter added; classification added; the reference path shipped `fetch_page(url, 1)`, i.e. zero retries, while its README claimed three |
  | web-research-agent-master | `utils/analyze_query.py:15-33` | LLM decomposition of a topic into subqueries | `curation/queries.py` | **PARTIAL** — decomposition already exists (Phase 3 emits `searchQueries` in the same structured call), so only dedupe + budget-fitting is ported. **No second query-LLM call**: that would be the duplicate search system this phase forbids |
  | web-research-agent-master | `tools/result_aggregator_tool.py:39` | build the final source list | `curation/aggregation.py` | **PORT + FIX** — first-observed order instead of set iteration; per-source citation counts; uncited records flagged not dropped |
  | web-research-agent-master | `main.py:64,73`, `analyze_query.py:39`, `content_analyzer_tool.py:10-11,30-31` | hardcoded `num_results=10`, `M=10`, `k=5`, `chunk_size=1000`, model `gpt-4o-mini-2`, and `search_strategy` misused as the retrieval query | — | **NO TAKE** — all became settings or do not exist here; the `search_strategy`-as-query bug is a defect, not a feature |
  | web-research-agent-master | `tools/web_search_tool.py:7-14` | Google Custom Search as the search engine | — | **REJECTED** — Firecrawl is the only web engine; adding Google CSE would be a second permanent search stack |
  | web-research-agent-master | `test_mock.py:18-22,49` | demo topic ("air pollution in India") with three fixed URLs | — | **NOT COPIED** — a fixed source set is the defect class this rebuild removed |
  | web-research-agent-master | `requirements.txt` (`chromadb`, `beautifulsoup4`, `numpy`, `httpx`, LangChain) | its runtime | — | **NO DEPENDENCY** — none of it is used; nothing in this project imports it |

  Defects found and fixed while writing these tests:

  | # | Defect | How it surfaced |
  |---|---|---|
  | P9 | **The planning turn never saw the retrieved material.** The Phase 2 port passed the transcript only to the submission prompt, so `plan_action` chose the next action blind — it could not tell "I have the salary" from "I have nothing". `data-enrichment-js` hands the whole message list to `callAgentModel` (`graph.ts:43-109`); the port dropped that. | `test_the_planning_turn_sees_what_has_already_been_retrieved` — the first assertion failed because the URL was simply not in the prompt |
  | P10 | **Robots verdicts were cached per origin instead of the file.** My first `HttpRobots` cached the *decision*, so a disallowed path poisoned the host (or an allowed one masked a disallowance). Fixed to cache the file text and evaluate per URL. | `test_a_disallowed_path_is_not_cached_as_though_the_whole_host_were_closed` |
  | P11 | **Relevance normalised by the size of the target**, so a page that matched four of ten requested terms scored 0.18 and any usable floor would have dropped everything. Changed to saturation at four matched terms, with the reference point named in the code. | Measured: printing the scores for a clearly relevant result before writing the floor test |

  **Not verified, stated plainly:** every case here runs on doubles. `FIRECRAWL_API_KEY` is still
  blank (length 0 in the shell and in `.env`), so no live search, scrape, session or `robots.txt`
  fetch has ever been made from this project. Specifically unmeasured: how long a real robots GET
  takes (bounded at 5 s by config, unproven), whether `restrict` on unreadable robots would in
  practice block a large share of useful sources, and whether lexical ranking is *good enough* —
  it can only be judged against real result sets, not against fixtures I wrote to agree with it.

  Deliberate non-additions: no embedding provider, no second search engine, no `map`/`crawl`
  budget model, no DNS-resolving SSRF guard (still Spring's, and now sharpened — see R32/R37).

## 3. Key Architectural Decisions Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-09-28 | **Three runtimes: Next.js + Spring Boot + FastAPI. No Node backend.** | The Firecrawl Python SDK (PyPI `firecrawl` 4.45.0) natively exposes `search`, `scrape`, `interact`, `browser`, `stop_interaction`, `map`, `crawl`, `parse`. The TS agent core does not implement web tools itself — it obtains them from `firecrawl-aisdk` (`agent-core/src/firecrawl-tools.ts:1,14`). So a Node runtime would exist only to reach an npm package whose Python equivalent already covers our needs. Details: `docs/audit/I-firecrawl-integration.md` |
| 2026-09-28 | **Do not vendor `@firecrawl/agent-core` (5,035 LOC).** Port only `schema-validate.ts` (~170 LOC), the two enforcement gates, and the prompt policy. | The core's autonomy (deepagents, subagents, workers, compaction) exists because *it* owns orchestration. Spring owns orchestration here, so importing it would create two orchestrators and two sources of truth for step state. The two gates are the actual anti-fabrication machinery and are absent from `agent-core-py` |
| 2026-09-28 | **`.internal/agent-core-py` is reference code, not a dependency.** | 352 LOC vs 5,035 LOC. No `interact`, no schema validation, `RunResult.steps` hardcoded `[]` (`agent.py:110,118`), `max_steps` accepted but never wired to PydanticAI (`types.py:33,45` vs `agent.py:46-51`), and it calls the sync SDK inside `async def` (`agent.py:61,81`). It lives in `.internal`, unpublished and unversioned |
| 2026-09-28 | **Spring Boot owns orchestration, governance and persistence; FastAPI is stateless.** | Python holds no DB connection, no job table, no session state. Nothing to lose on restart — which is what makes the no-Redis constraint safe. Python's quality output is advisory; Java re-enforces the contract before persisting |
| 2026-09-28 | **Source governance moved outside the agent.** Java clears URLs before Python ever sees them. | In the old project the policy gate was a wrapper *inside* the agent adapter (`FirecrawlAgentAdapter.ts:242-309`), so an agent could in principle be built without it. Structurally stronger position now |
| 2026-09-28 | **No `DEMO_MODE`, no silent fallbacks. Missing credential ⇒ startup failure.** | The old project substituted `DemoRequirementProvider` / `DemoWorkflowPlanProvider` when no LLM key was present (`requirements/index.ts:17-19`, `planner/index.ts:19-21`) and `DemoAgentAdapter` when no Firecrawl key was present (`server.ts:56-62`). Its `.env` had `DEMO_MODE=false` with an **empty** `FIRECRAWL_API_KEY`, so all collection was simulated while appearing real. This is the root cause of the hardcoded-schema defect |
| 2026-09-28 | **Drop `backend/src/modules/demo/` entirely.** | 834-line `scenarios.data.ts` hardcodes Tracxn/Inc42/YourStory sources, 52 real + 50 fabricated startups (founder `Dr. Ramesh Gupta N`), and `dynamic-scenario.generator.ts` hardcodes 15 YouTube channels behind a `prompt.includes("youtube"\|"channel"\|"video"\|"coding")` trigger (`:127`) — the exact prompt in the brief |
| 2026-09-28 | **Reuse the old Prisma domain model, including compound tenant-scoped foreign keys.** | `(workspace_id, id)` unique keys let FKs reference both columns, making cross-workspace links unrepresentable rather than merely unchecked. Best idea in the old schema. Translated to JPA + Flyway |
| 2026-09-28 | **Flyway, not Liquibase.** | The schema leans on MySQL-specific features (JSON, generated columns, ENUM, `FOR UPDATE SKIP LOCKED`), so SQL-first migrations are clearer than an abstraction layer, and versioned `.sql` files are easier to review |
| 2026-09-28 | **MySQL job queue with `FOR UPDATE SKIP LOCKED` / atomic conditional UPDATE claim, lease + heartbeat, and a stale-recovery sweeper.** | Anakin — the nominated job-architecture reference — has **no** durable claim at all: its queue is an in-process Go channel (`worker/worker.go:20-36,60-62`), grep confirms no `FOR UPDATE`, `SKIP LOCKED`, advisory lock or version column in `server/`, and it has no heartbeat or stale recovery. We adopt its patterns and add the durability it lacks. SQL in `docs/audit/J-no-redis-job-architecture.md` |
| 2026-09-28 | **Terminal job-state writes use `REQUIRES_NEW` with a short timeout.** | Anakin's `persistCtx` (`processor/processor.go:24-33`) uses `context.WithoutCancel` because the job context is already expired when recording failure — otherwise a timed-out job stays stuck in `processing` forever. The old project had no equivalent, and its in-process export promises stranded jobs in `RUNNING` on restart (`export.service.ts:41-53`) |
| 2026-09-28 | **Retry uses persisted `attempt_count` + exponential backoff with jitter.** | Anakin retries immediately with no backoff, keeps the count only in a loop variable, and ships `MAX_JOB_RETRIES` as dead config never read by the processor (`config.go:26,64`). The old project configured no BullMQ `attempts` and used `jobId = runId`, so a failed run could never be re-enqueued (`workflow-execution.service.ts:32`) |
| 2026-09-28 | **Single-node deployment for v1.** | Without Redis, SSE fan-out and per-domain rate limiting are in-process. Multi-node would silently drop live events and multiply the real request rate against sources — a governance violation, not just an inaccuracy. Claim SQL is still written for scale-out |
| 2026-09-28 | **`google-genai` with native structured output, not `pydantic-ai`.** | `agent-core-py` declares `pydantic-ai>=1.70.0` while current is `2.51.0` — a floor spanning a major version. We need no agent loop, so its main value is unused. Gemini's `response_schema` constrains decoding at the provider |
| 2026-09-28 | **Gemini schemas must strip the `const` keyword.** | Documented upstream failure mode (`agent-core/README.md:399-401`); Gemini is our default provider, so this would otherwise surface only at runtime |
| 2026-09-28 | **No code from `anakin-master` or `TheAgenticBrowser-main`.** | `anakin-master/NOTICE:1-4` = AGPL-3.0 (network-use clause would copyleft the product). `TheAgenticBrowser-main/LICENSE:1-30` §1.1 excludes providing a competing online service — which this platform is. Every reuse item is marked `PORT (concept only)` in `docs/audit/C-repository-reuse-map.md`. The old project reached the same conclusion and copied zero code from either (`Memory.md:56,127-128,139`) |
| 2026-09-28 | **`web-research-agent-master` (MIT) and Firecrawl `agent-core` (MIT) may be copied.** | Verified `LICENSE:1-3` (MIT, Copyright (c) 2025 Dev Dalia) and `agent-core/package.json:118` (`"license": "MIT"`). Caveat: upstream `agent-core/` ships **no LICENSE file** — the MIT declaration is metadata only. Keep notices with every copied file |
| 2026-09-28 | **PirateAgentUI's real CSS tokens are the design system of record; the old `Design.md` is superseded.** | `Design.md` specifies white/`#3B5BFF` blue/Inter in a "Linear/Vercel" idiom. The shipped UI is parchment `#E8DFCF` / brown `#5A3928` / tan `#B78B62` with Cormorant Garamond headings (`app/globals.css:6-43`, `tailwind.config.ts:48-50`). The brief requires preserving PirateAgentUI. Tokens recorded verbatim in `docs/audit/D-frontend-reuse-map.md` |
| 2026-09-28 | **Frontend fabrication removed on both sides of the contract.** | The UI invented confidence `90` and `sourceIds: src-1…src-n` (`datasets/[id]/page.tsx:120-131`); the API invented the *same* values (`datasets.routes.ts:240-251`) plus synthetic progress `100/50/0` (`workflows.routes.ts:92`) and `targetCount: 100` / `entity: "Record"` (`requirements.routes.ts:15,32`). Absent data must render as absent |
| 2026-09-29 | **Every "tests pass / typecheck clean / build succeeds" claim must be produced by a command run in that session, reporting counts and naming skipped checks.** | Verified against the old project: its `Memory.md:11,244,298,332` assert 213 passing tests, 0 lint errors, clean typecheck and a successful build, but running those exact commands today gives 195/202 with 3 suites failing to load, 14 + 32 lint errors, and 10 typecheck errors. A false green baseline propagated through every doc citing it. Detail: `docs/audit/N-scripts-and-dependencies.md` |
| 2026-09-29 | **Do not "clean up" the old project's six unimported provider packages.** | `backend` statically imports none of `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@langchain/anthropic`, `@langchain/google`, `@langchain/google-genai`, `@langchain/openai` — which looks like dead weight and is **not**: the vendored core declares all seven as `peerDependencies` and `ai` resolves providers dynamically, so the consumer must install them. Recorded so a future dependency audit does not delete a working system |

| 2026-09-29 | **Configuration validation lives in exactly one place per service** (`StartupRequirementsValidator` in Java, the model validator in `config.py`), not in nested Bean Validation annotations. | My first draft put `@NotBlank` on nested `Database`/`AiService` records and it **silently did nothing** — nested constraints do not cascade without `@Valid`. Enforcing nothing while advertising it is the same class of defect found in the old project (an `EXPIRED` status no sweeper ever set). The consolidated validator reports every problem at once, names variables instead of values, and is covered by 12 tests |
| 2026-09-29 | **Backend uses `spring-boot-starter-jdbc` (Hikari + `JdbcTemplate`), not JPA, in Phase 1.** | There are no entities yet. `starter-data-jpa` would add an ORM with nothing to map. The readiness probe needs only a connection, which JDBC provides |
| 2026-09-29 | **Container liveness must never include the database.** `/actuator/health/liveness` = `livenessState,ping`; `/actuator/health/readiness` = `readinessState,db`. | A DB outage would otherwise make the orchestrator restart perfectly healthy processes in a loop. Verified: with MySQL unreachable, liveness is `UP` and readiness is `DOWN`. The default `probes.enabled: true` alone was **not** sufficient — it put the db indicator in readiness but left the aggregate `/actuator/health` DOWN, which is what a naive healthcheck polls |
| 2026-09-29 | **Health and ready are mapped at both `/health` and `/api/v1/health`.** | Root paths are what container and orchestrator probes expect; the prefixed paths are what the Next.js same-origin rewrite can actually forward. One handler, two path forms |
| 2026-09-29 | **The AI service gets no CORS layer.** It uses `TrustedHostMiddleware` + `X-API-Key` and is not published to any host port in compose. | The browser never calls it — Spring is the only client. CORS there would be dead surface on a service that holds provider credentials. `ALLOWED_HOSTS` rejects foreign `Host` headers (tested: 400), closing DNS-rebinding |
| 2026-09-29 | **Provider SDKs (`google-genai`, `firecrawl`) moved to a `collection` extra; base install is FastAPI/uvicorn/Pydantic/python-dotenv only.** | Phase 1 makes no provider calls, and pinning wheels that may not exist for the installed interpreter makes the skeleton unbuildable. Deliberately reversible, not a permanent decision — they return in Phase 2 |
| 2026-09-29 | **`scripts/verify.sh` is the single aggregate gate for all three layers, printing counts and explicit `SKIP` reasons.** | The old project had eight disconnected scripts and no aggregate entry point, which is how "213 tests pass, 0 lint errors, typechecks cleanly" survived in its memory file after none of it was true. See `N` §N.4 |

| 2026-09-29 | **Add extraction gate 3 — a completeness critique inside the research loop** — ported as a pattern from `data-enrichment-js` `graph.ts:114-136,155-225,266-291`, not copied. Gates 1 (schema-validate) and 2 (no answer before data) catch malformed or fabricated shape; neither catches *well-shaped but hollow* data. | The one genuinely non-duplicative idea in either new repository. Bounded on **every** path (unlike the original, whose bound guards only the critique exit), and exhaustion must yield `FAILED` / `COMPLETED_WITH_WARNINGS`, never a silent green. Deterministic gate 1 stays mandatory and first, so an LLM judge can add work but can never approve alone |
| 2026-09-29 | **Firecrawl remains the sole web engine; Bright Data and Tavily are rejected outright.** | Redundancy plus a governance conflict: `ai-data-enrichment-agent` describes its Bright Data unlocker as *"bypassing anti-bot protection"* (`enrichment_agent.py:40`), which would make our `allowCaptchaBypass=false` safety literal a lie. The brief permits a second engine only for a genuinely missing capability; none was found. `data-enrichment-js`'s own scraper is a bare `fetch` with no SSRF guard, no robots check, no timeout, and no `response.ok` test (`tools.ts:44-70`) — strictly worse than Firecrawl and unsafe to imitate |
| 2026-09-29 | **Nothing from the new repositories stays in TypeScript; no fourth runtime.** | Verified: `workflow.compile()` is called with no checkpointer (`graph.ts:309`), `src/` writes nothing to disk, and the three nodes plus two routers reduce to a while-loop over a message list with an integer counter. Wrapping ~700 LangGraph lines in a Node service to preserve a language choice would recreate exactly the two-orchestrators problem Phase 0 rejected (`A` §A.1) |

| 2026-09-29 | **Two nesting levels, not two orchestrators:** Spring owns the outer plan DAG (`SEARCH → SCRAPE → EXTRACT → … → SAVE`, persisted, auditable); the `data-enrichment-js` research graph lives *inside* a single `EXTRACT` step in Python, ephemeral and bounded. | The master instruction names `data-enrichment-js` the primary research foundation and forbids collapsing it into one LLM call, while Phase 0 forbids two orchestrators. Nesting satisfies both: Spring never re-implements the research loop, and Python never decides whether a step runs. Full node-by-node mapping in `O` §O.12 |

| 2026-09-29 | **The pipeline is two AI-service calls with Spring's gate between them**, not one `from-prompt` call on Python. | Python can run the whole chain in one request, and does expose that endpoint — but then Spring would be forwarding an unverified AI answer straight into a web collection run. `/api/v1/research/from-prompt` analyses, validates the contract and schema in Java, and only then starts collection. This is the exact shape that failed in the old project, where nothing independently checked the model's answer |
| 2026-09-29 | **`additionalProperties: false` stays in the internal contract; `to_gemini_schema()` projects it away for the provider only.** | Measured live: Gemini answers `400 INVALID_ARGUMENT — Unknown name "additional_properties" at generation_config.response_schema`. Dropping it everywhere would have disarmed gate 1's extra-key detection to satisfy a provider, so the strict schema is the source of truth and the provider gets a projection. Same reasoning as stripping `const`, which alone was not enough |
| 2026-09-29 | **`RequirementValidator` (Java) deliberately mirrors `Requirement.cross_validate` (Python).** | The duplication is the point: Java is the system of record and must not persist or collect against a contract only the model vouched for. Same rules the old project's `requirement.schema.ts` declared — the difference is that it is now actually enforced, on the side that owns the data |
| 2026-09-29 | **DTO parsing is not a contract-drift alarm** — and the code now says so rather than pretending otherwise. | I asserted that unknown JSON keys would be rejected; the test showed Spring Boot disables `FAIL_ON_UNKNOWN_PROPERTIES` and a class-level `ignoreUnknown = false` does not re-enable it, so a key added on the Python side is dropped silently. `PipelineControllerTest.unknownKeysFromTheAiServiceAreDropped` pins the real behaviour; drift has to be caught by the structural rules and a versioned envelope, not by Jackson |
| 2026-09-29 | **Phase 4 "use actual code from `web-agent-main`" is satisfied by porting behaviours into the Python web layer, not by running its TypeScript core.** | Reported as a deviation, not hidden: `firecrawl-tools.ts` obtains every web tool from the npm package `firecrawl-aisdk`, so "use the actual Firecrawl tools code" means using an npm package. The Python SDK exposes the same endpoints (`browser`, `interact`, `stop_interaction`, `search`, `scrape` — verified by introspection of `firecrawl` 4.45.0), and Phase 0 ruled out a fourth runtime and rejected vendoring 5,035 LOC that would create a second orchestrator. What is reusable from that repo is its *hard-won logic* — the timeout envelope, null-stripping, tool filtering, the skills loader, the no-interact-in-workers rule — and all of it is now ported, with the source line cited in the code that replaced it |
| 2026-09-29 | **`interact` is opt-in at the service ceiling (`ALLOWED_WEB_TOOLS`), and a request can only narrow it.** | It is the one web tool that acts on a page rather than reading it, and it bills a live session with a TTL. Keeping it off by default means the bypass-risk surface and the credit surface are both operator decisions; the prompt adds rule 6 (never use a session to get past a login, CAPTCHA or paywall) and `run_interact` requires a URL the run already retrieved |
| 2026-09-29 | **Site playbooks load deterministically from observed URLs instead of being offered to the model as `load_skill` / `lookup_site_playbook` tools.** | Upstream needs two extra tool round trips and hopes the agent calls them. Here the match happens on `state.observed_urls()`, so guidance appears exactly when the run touches that domain, costs no model turn, spends no budget, and is recorded in `metadata.playbooksUsed` for the reviewer |
| 2026-09-29 | **No SKILL.md content is copied, and the platform ships zero playbooks.** | `web-agent-main`'s six playbooks describe its own demo targets. Copying them would smuggle a hardcoded default source list back in — the defect class `00-FORENSIC-AUDIT.md` §4 was written about — and `data-enrichment-js`'s enrichment targets are licence-unresolved (**L1**). The loader is real and tested; the content is this deployment's to write and verify |
| 2026-09-29 | **Java validates tool-request *shape*; the tool *ceiling* stays in the Python service.** | Two ceilings would be two places to keep in sync and would disagree in production. Java refuses names it cannot honour, an empty list, an out-of-range session budget, and a budget for a tool the request did not ask for; the service that runs the tools and spends the credits decides which tools exist, and reports the intersection back in `metadata.enabledTools` |
| 2026-09-29 | **Relevance is lexical and saturating, not an embedding similarity — and no embedding provider is added.** | Upstream ranks by cosine-similating the query against Azure OpenAI snippet embeddings (`get_relevant_urls.py:7-12`). Adopting that means a second AI provider whose only job is ranking, in a project that has one LLM and one web engine. Lexical scoring is deterministic, costs nothing, explains itself in `score.reasons`, and can be tested — with its weakness named in the module docstring rather than hidden. If it proves too weak against live result sets, the upgrade path is a Gemini rerank over ~8 candidates, not a new provider (**Q1**) |
| 2026-09-29 | **Query analysis is *not* ported as a second LLM call.** | `web-research-agent-master` decomposes the topic with an LLM (`analyze_query.py:15-33`); Phase 3 already emits `searchQueries` inside the same structured call that produces the contract. Calling a model again to rewrite queries is the duplicate search system this phase forbids, so only its dedupe and budget-fitting halves are ported (`curation/queries.py`) |
| 2026-09-29 | **Unreadable robots.txt refuses the source by default.** | Upstream already fails closed on exception (`web_scraper.py:29-31`) but accidentally: it parses a 500 error page as "no rules" and allows everything. Deliberate `restrict` is the position that cannot be argued to have bypassed a site's stated wishes; the cost — a host whose robots endpoint is flaky yields no data — is made visible via `validation.refusedSources` and switchable with `ROBOTS_ON_ERROR=allow` |
| 2026-09-29 | **The `RetryPolicy` and `SearchStrategy` contracts from Phase 0 are now actually consumed** rather than inventing parallel config. | Both were ported as contract classes with no producer or reader. `Settings.retry_policy` builds the former for the web layer; `curation/queries.build_strategy` is the sole producer of the second, and `metadata.searchStrategy` reports what ran. A contract nobody reads is how the old project's `maxInfoToolCalls` and `max_requests_per_domain_per_minute` came to exist unwired |
| 2026-09-29 | **Curation lives in Python, request *shape* is validated in Java, and the ceiling stays in one place.** | Same division as Phase 4's tool ceiling: the service that fetches decides and reports; Spring refuses nonsense before paying for a round trip. A second policy implementation in Java would be a second place for the two to disagree |
| 2026-09-29 | **`domain_allowed` moved from `research/tools.py` to `curation/policy.py`.** | One policy path: allow/block and robots are decided by the same call that every tool consults, so a scrape cannot pass a check the search stage skipped |

## 4. Database / Schema Changes

**No tables were created in Phase 1 — there is no schema yet.** Flyway was deliberately not
added until there is a migration to run; wiring it with zero migrations would have been
configuration nobody exercises.

`docs/audit/E-database-model.md` specifies the target: 21 tables across 7 Flyway
migrations (`V1__baseline_identity` … `V7__seed_dev`), translated from the old project's 16
Prisma models plus three new tables — `workflow_jobs` (the MySQL queue), `refresh_tokens`
(replaces Redis revocation) and `source_domain_policy` (per-domain governance config).

What Phase 1 did establish about the database: the backend binds `MYSQL_HOST/PORT/DATABASE/USER/
PASSWORD` into a Hikari `DataSource` (`initialization-fail-timeout: -1`, so an unreachable server
degrades to a `503 /ready` rather than a stack trace at boot), and `database/` holds a disposable
MySQL 8.4 container plus a read-only `smoke-test.sql`. Neither has been executed: Docker is absent
and no database user matches the configured credentials.

## 5. Known Bugs / Issues / Verification Limits

Carried from the audit as things the rebuild must **not** reproduce:

1. **Authorization was effectively absent.** `app.ts:71-74` mounted only `optionalAuthenticate`;
   `requireWorkspaceAccess` was defined but never applied; `datasets.routes.ts:13` says
   "auth placeholder"; routes trusted client-supplied `workspaceId`/`userId`. An unauthenticated
   caller could read any workspace given its UUID — while `Memory.md:117` claimed authorization
   was "fully active".
2. **The live collection path was never runnable.** `DEMO_MODE=false` with an empty
   `FIRECRAWL_API_KEY` ⇒ `DemoAgentAdapter`. `Memory.md:112` admits no live Firecrawl call was
   ever made. The reported metrics (98.1% success, 52 records, 14 sources) came from the
   simulator, as did the 24 artifacts in `backend/demo-exports/`.
3. **`Memory.md:118` claimed no `.env` exists.** Two do (`.env`, `backend/.env`, byte-identical,
   22 populated variables). They are gitignored and untracked (verified via `git ls-files`), so
   nothing leaked to history — but the claim was false and the duplication is a drift hazard.
4. **Deployment topology could not have worked.** Compose ran the backend on :3000 with
   `FRONTEND_ORIGIN=localhost:5173` (a Vite port), while `next.config.js:15-22` hardcoded the API
   rewrite to `localhost:4000`.
5. **Forgeable tokens.** `server.ts:83-86` and `docker-compose.yml` both defaulted JWT secrets to
   literal strings.
6. **Seeded backdoor login** `demo@pirateagent.ai` / `Demo1234!` (`prisma/seed.ts:39-69`).
7. **Exports were not queued** — in-process promises stranded jobs in `RUNNING` on restart; the
   `EXPIRED` status and `expires_at` existed but nothing enforced them.
8. **Silent row loss** — `persistDataset` did `continue` on records without verified sources
   (`workflow-execution.repository.ts:271-272`), so datasets could land `PARTIAL` unexplained.
9. **Workflow runner was sequential only**; plan dependencies merely marked steps `SKIPPED`
   (`workflow-runner.ts:24,58-64`). `EXPORT` always returned `SKIPPED`/`EXPORT_NOT_IN_PHASE`
   (`:167-169`).
10. **Row search used `LIKE '%…%'` over a JSON column** with no index
    (`dataset-query.repository.ts:732-741`).
11. **`GET /api/v1/rows/:id/evidence`** passed 3 args to a 4-arg signature
    (`datasets.routes.ts:308`).
12. **Tests locked in demo behaviour** — `demo-scenarios.test.ts` and parts of
    `e2e-validation.test.ts` assert the hardcoded fixtures. Two integration suites are skipped by
    default, so "213 tests pass" excluded them.
13. **Dark mode was unreachable** — the `.dark` palette exists (`globals.css:45-72`) but nothing
    ever adds the class, and there is no `next-themes`.
14. **No-op Tailwind classes** — `shadow-xs`, `h-4.5`, `w-4.5`, `translate-x-5.5` do not exist in
    Tailwind v3 or the project config and silently render nothing.
15. **The old project does not build in this checkout.** `node_modules/@aidp/backend` and
    `node_modules/@aidp/firecrawl-agent-core` are empty real directories (0 entries), not workspace
    links, so `@aidp/firecrawl-agent-core` is unresolvable: `npm run typecheck` exits 1 with
    10 × `TS2307`. `package-lock.json` is correct — nested `npm install` runs
    (`backend/node_modules`, `packages/firecrawl-agent-core/node_modules`) alongside the root
    workspace install are what desynced it. Measured 2026-09-29.
16. **Its recorded quality baseline is not reproducible.** `npm run lint` → 14 errors;
    `npm run lint:frontend` → 32 errors; `npm run test` → 3 of 20 suites fail to load,
    **195 passed / 202 collected** against a claimed 213.
17. **Orphaned / absent scripts.** `backend/src/scripts/check-apis.ts` is not referenced by any npm
    script; `PirateAgentUI` has no `typecheck` script; `docs:generate` exists in `backend` but is
    not surfaced at the root, and there is no aggregate `verify` command.
18. **Two minor dependency defects.** `@types/bcryptjs@2.4.6` is installed for `bcryptjs@3.0.3`,
    which ships its own types — the stale DefinitelyTyped package shadows them. `recharts` is
    declared in the frontend and imported nowhere.
19. **25 MB duplicate tree excluded only locally.** `.kilo/worktrees/extreme-apogee/` contains a
    full copy of the project plus all four reference repos, excluded via `.git/info/exclude` — which
    is **not shared on clone**, so a fresh checkout shows it as untracked. It should be in
    `.gitignore`. Note: `FINALAIAGENT/.gitignore` was created in this session for exactly that
    reason.

### Defects found and fixed during Phase 1 (all by running, not reading)

| # | Defect | How it surfaced |
|---|---|---|
| P1 | **Nested Bean Validation was inert** — `@NotBlank` on `Database`/`AiService` records never ran without `@Valid` cascade, so the annotations were decoration. | Writing a test for a blank field and watching it pass |
| P2 | **Jackson serialized a derived `up` boolean** into every readiness component (`isUp()` on a record is a getter), duplicating `status` and diverging from the documented contract. | Inspecting the real `/api/v1/ready` body |
| P3 | **Aggregate `/actuator/health` went `DOWN` with MySQL unreachable** even after enabling probe groups, so any healthcheck polling it restart-loops healthy containers. | Probing `/actuator/health` directly |
| P4 | **`scripts/_common.sh` `load_env` exported blank `.env` assignments**, overriding a real `GEMINI_API_KEY` already in the environment and making the AI service refuse to start for what looked like a missing credential. | `dev-ai.sh` failing after the bootstrap created an empty `GEMINI_API_KEY=` line |
| P5 | **Python mask regex reused the Java group indices.** The Java alternation captures, the Python one is non-capturing, so `m.group(5)` raised `IndexError` and every masked log line would have crashed the formatter. | `test_logging.py` |
| P6 | **Framework 404s bypassed the shared error envelope** — FastAPI resolves handlers by exact exception type, so registering only `fastapi.HTTPException` left Starlette's routing 404 returning `{"detail": …}`. | `test_health.py` |
| P7 | **`mvn package` left a 37 KB thin, non-bootable jar** because a running `java -jar` locks the artifact on Windows and the repackage step failed with its output hidden by a pipe. Cost a wasted debugging cycle against a "silent" server. | `no main manifest attribute` in the boot log |
| P8 | **`FirecrawlWeb.search()` used `INTERACT_TIMEOUT_SECONDS` as its deadline** — the search budget was the browser session's, and `SEARCH_TIMEOUT_SECONDS` did not exist. Two tools sharing one timeout is invisible until someone reasons about a slow search. | Reading the client while adding `interact`, then fixed with a regression test that asserts the message names `search` |

None of these were visible from the source alone. The lesson from `N` §N.6 held: run it.

Environment limits affecting verification:

- **Docker is not installed**, so Testcontainers is unavailable. Integration tests must run
  against the native MySQL 9.6 service on a disposable schema, gated by a property. Reports must
  state which tests ran and which were skipped.
- **Python 3.14.6 is installed**, not 3.12. The Phase 1 base install (FastAPI, uvicorn, Pydantic
  v2, pydantic-settings, python-dotenv) resolved and tested cleanly on it — 31 passed. The
  **provider SDKs were never attempted**, which is why they sit in the `collection` extra. Install
  3.12 before the Phase 2 spike. Bare `python` still resolves to the Windows Store alias; use `py`.
- **Phase 1 limits, stated plainly:**
  - `/api/v1/ready` has **never returned 200**. Every Phase 1 run reported `mysql: DOWN` because
    `MYSQL_USER`/`MYSQL_PASSWORD` in `.env` match no account on the native `MySQL96` service. The
    probe reaches the server and reports the reason, which is the intended behaviour, but the
    criterion "all three processes start and `/ready` returns 200" is **not met**.
  - No `database/smoke-test.sql` execution and no Testcontainers: Docker is absent.
  - Nothing in `deploy/` or the three `Dockerfile`s has been built.
  - `GEMINI_API_KEY` is present in the developer's shell environment. Phase 1 made **no provider
    call**, so it was neither used nor billed.
  - Frontend `npm run lint` reports **5 warnings** (custom font, three `<img>`, one
    `exhaustive-deps`) inside verbatim-copied design files. Left unfixed on purpose: editing them
    would break byte-identical preservation of the design system. Zero errors.
  - Phase 1 code is **uncommitted** on the `implementjava` branch.
- **Firecrawl has still never been called for real.** Phase 4 asked for "real and mocked Firecrawl
  execution"; only the mocked half was possible. Measured again this session: `FIRECRAWL_API_KEY`
  has length **0** in the shell **and** in the root `.env`, so
  `tests/test_live_firecrawl.py` skips all three cases (`-rs` confirms the reason, not a silent
  pass). What is verified is our own lifecycle logic against a **stub of the SDK client** — session
  created, prompt sent as `prompt=`, deadline applied, session closed on success, on SDK failure
  and on timeout, null fields stripped, truncation marked. What is *un*verified is Firecrawl's side
  of that contract: whether a prompt-mode session answers, how long it takes, what it bills, and
  whether `interact` is adequate at all (**G2**).
- **No SKILL.md playbook ships**, so the loader is exercised only on test fixtures written in
  `tests/test_skills.py`. `SKILLS_DIR` therefore points at a directory that does not exist in this
  checkout; `/ai/v1/ready` reports `skills.loaded: 0` rather than failing. This is a deliberate
  alternative to copying upstream's six playbooks, whose targets would become an unverified default
  source list.
- **The curation stage has never seen a real result set.** Phase 5's ranking, floors, domain caps
  and `min_relevance_score` defaults were tuned against fixtures I wrote, which is exactly the
  condition in which a relevance heuristic looks better than it is. Two numbers are therefore
  provisional, not findings: whether lexical scoring ranks real Firecrawl results usefully (**Q1**),
  and whether `ROBOTS_ON_ERROR=restrict` blocks a tolerable or an unacceptable share of sources
  (no `robots.txt` fetch has ever been made from this machine).
- **robots.txt is read from our egress, not the crawler's.** Firecrawl fetches the page;
  `HttpRobots` fetches `robots.txt` from *this process*, so the two can disagree — a host that
  blocks Firecrawl's IP or serves different rules to its crawler gets a policy we did not read.
  `ROBOTS_USER_AGENT` is our token, and we honour what it is told. R37 records this as a standing
  limitation rather than a solved problem.
- **No completed live provider call has been made.** Phase 3 sent real requests to Gemini and they
  were rejected before generation — first by our own schema bugs (now fixed), then by quota
  (`429 RESOURCE_EXHAUSTED`). Firecrawl has never been called: no `FIRECRAWL_API_KEY` exists here.
  Provider behaviour is still documented from SDK introspection, not from a successful run.
- **The Gemini key on this machine is a free-tier key: 20 `gemini-2.5-flash` requests/day.** That
  budget is spent during a single three-prompt live verification, so live work must be
  deliberate: the gated tests exist precisely so it is not burned by an ordinary `verify.sh`.
  Plan capacity or a paid key before the provider phase, and expect 429s to need backoff (not yet
  implemented — the error is surfaced, not retried).
- **Not run, on purpose:** `npm run build` (writes `backend/dist`) and `next build` (writes
  `.next/`) in the *old* project — the audit is of the checkout as delivered, and those would have
  modified it. Its "production build succeeds" claim is therefore recorded as **unverified**,
  alongside the failures that were measured. `backend/dist` exists with 84 files and no newer
  `src/`, so a build did succeed at some point while the workspace links were alive.

## 6. Open Decisions

| Gate | Question | Status |
|---|---|---|
| **G1** | With `DEMO_MODE` removed, how will this be demonstrated to judges? (a) test fixtures + run replay *(recommended)*, (b) guarded `SYNTHETIC_MODE` that can never trigger on a missing key, (c) funded keys and demo live. See `docs/audit/L-risks.md` R8 | **Awaiting user decision** |
| **G2** | Is the Firecrawl Python SDK's `interact` sufficient? Fallback is the Express sidecar implementing `agent-core/openapi.yaml` — a fourth runtime requiring its own recorded decision. See `docs/audit/I-firecrawl-integration.md` §I.6 | **Narrowed twice, still open on live behaviour.** Phase 4 confirmed the whole session lifecycle is expressible in Python and implemented it: `browser()` → `interact(job_id, prompt=…)` → `stop_interaction(job_id)`, all three verified present on `AsyncFirecrawlApp` in `firecrawl` 4.45.0 by introspection, with the `job_id`-first shape handled by opening the session inside the tool call. So the sidecar is not needed for *API shape* reasons. Whether a real prompt-mode session completes inside a sane deadline and returns usable text is **unmeasured** — no `FIRECRAWL_API_KEY` here. Resolve with `RUN_LIVE_FIRECRAWL_TESTS=true pytest -q tests/test_live_firecrawl.py -s` once a key exists |
| **B1** | `finalagent_dev` needs a MySQL account the application can connect as, or `/ready` can never return 200. Options: (a) create a user on the native `MySQL96` service (needs its credentials — I will not guess them), (b) install Docker and use `database/docker-compose.yml`, which mints the user from `.env`. | **Blocking the last Phase 1 exit criterion — awaiting user choice** |
| **L1** | Both new repositories have unresolved licences: `data-enrichment-js-main` claims `"license": "MIT"` in `package.json:7` with **no licence text anywhere in the tree**, and `ai-data-enrichment-agent-main` has **no licence at all**. May we adapt logic from either? Options: (a) treat a `package.json` declaration as sufficient, as already done for `web-agent-main` under R2, (b) verify upstream terms before Phase 2, (c) re-implement gate 3 from the behavioural description in `O` §O.4 without translating their source. | **Awaiting user ruling** (R28, R29) |

| **L2** | Phase 2 research graph: depend on the `langgraph` PyPI package, or express the same topology as a plain Python state machine? Evidence says nothing in `data-enrichment-js` needs the runtime (no checkpointer, no disk writes, no interrupts — `O` §O.12), so a state machine preserves the graph without a new heavy dependency. Either satisfies the master instruction | **RESOLVED at Phase 2 — plain Python state machine, no `langgraph` dependency.** Node and edge names
are declared on `ResearchGraph.NODES` / `EDGES`, so the template's topology is preserved and a later
swap stays mechanical |
| **S1** | Site playbooks: `app/research/skills.py` loads `SKILL.md` files, but this deployment ships **none**. Who writes them, against which verified targets, and does the demonstration need any? Format and rules are documented in `ai-service/skills/README.md`. | **Open — created at Phase 4.** The loader is tested (24 tests) and `SKILLS_DIR` defaults to a directory that does not exist yet, which is a supported state. Upstream's six playbooks were not copied; writing our own requires observing real sites, which needs a Firecrawl key |
| **Q1** | Is lexical relevance good enough? `curation/relevance.py` counts requested vocabulary in a result's title, snippet and URL path, saturating at four matched terms. Upstream used embedding cosine similarity instead, and this build rejected adding an embedding provider for a ranking step. The alternative that does not add a provider is one Gemini rerank over the ~8 ranked candidates per search. | **Open — created at Phase 5.** Untestable here: the numbers below were chosen against fixtures, and there is no `FIRECRAWL_API_KEY` to produce real result sets. Judge with `RUN_LIVE_FIRECRAWL_TESTS=true` on ~20 searches, then decide between "keep lexical", "set `MIN_RELEVANCE_SCORE`", and "add a rerank call" |
| **Q2** | Should `ROBOTS_ON_ERROR` stay `restrict`? A host whose robots endpoint 5xxes or is unreachable currently yields no data, by design. | **Open — created at Phase 5.** Fails closed on purpose (see §3), but the cost is unmeasured because no robots fetch has ever run here. Revisit with real hosts; `validation.refusedSources` reports the occurrences either way |

## 7. Environment / How to Run

Toolchain on this machine, all verified present and used by the Phase 1 run:

| Tool | Version | Status |
|---|---|---|
| Java | 21.0.8 LTS | used to compile and run the backend |
| Maven | 3.9.11 | used for `test` / `package` / `spring-boot:run` |
| Node / npm | 24.19.0 / 11.17.0 | used for install, typecheck, lint, build, dev server |
| Python | 3.14.6 (`py`); pip 26.1.2 | used via `ai-service/.venv`; **3.12 still required for the provider extra** |
| MySQL | 9.6.0, service `MySQL96`, port 3306 | running, reachable, **no matching application user** |
| Docker | — | **not installed**; nothing in `database/` or `deploy/` has been built |

### First time

```bash
bash scripts/bootstrap-env.sh                 # creates .env, generates secrets, never prints them
cd ai-service && py -m venv .venv && .venv/Scripts/pip install -e ".[dev]"
cd frontend && npm install
```

### Run

```bash
bash scripts/dev-ai.sh                        # http://localhost:8000  (AI_SERVICE_PORT)
bash scripts/dev-backend.sh                   # http://localhost:8080  (SERVER_PORT)
bash scripts/dev-frontend.sh                  # http://localhost:3000; add `-- -p 3210` if busy
bash scripts/verify.sh                        # 27 backend + 31 python + 3 frontend gates
bash scripts/verify.sh backend                # one layer
```

Ports are 8080 / 8000 / 3000 and documented once, in `.env.example`. The old project's
3000-vs-4000-vs-5173 mismatch is designed out: the frontend proxies `/api/v1/*` to
`BACKEND_ORIGIN`, so the browser only ever sees one origin.

### Secrets

`.env` now exists at the repository root and contains generated secrets. It is **gitignored**
(`git check-ignore -v .env` → `.gitignore:2:.env`), and because the root patterns carry no slash
they also match `.env` and `.env.*` at every depth — `backend/.env`, `ai-service/.env` and
`frontend/.env.local` are all ignored by that one file. Both example files stay committable via
`!.env.example` and `!.env.*.example`, confirmed by `git status` listing them as untracked rather
than by `check-ignore`, which prints the last matching pattern even when it is a negation.

No secret value appears in any tracked file. `.env.example` holds names only.

## 8. Next Step

**Awaiting authorization.** Phases have been directed out of `M-phase-plan.md` order: Phase 3
delivered the plan's Phase 4 (requirement understanding) and part of Phase 5 (schema generation),
Phase 4 delivered the plan's Phase 6 web-execution half (Firecrawl tools inside the graph), and
Phase 5 delivered most of the plan's Phase 7 (source governance) **at fetch time** — robots,
domain policy, ranking and dedupe — while the plan's Phase 3 (authentication), Phase 6 job engine
and host-resolution SSRF/rate limits remain unbuilt. That drift is not a problem to hide: `M` now
carries a delivery note under Phases 7 and 8, and should be reconciled before another phase is
chosen.

Most valuable next candidates, in dependency order:

1. **The MySQL schema + Flyway baseline** — nothing has anywhere to be persisted, so every phase
   after this one currently returns results into the void.
2. **Authentication and tenancy** — `/api/v1/requirements/parse` and `/api/v1/research/from-prompt`
   are unauthenticated and, unlike Phase 2's endpoint, the latter now makes real provider calls, so
   an open instance is a billing risk as well as a data one. `interact` raises that again: a run can
   now drive a live browser session, so `ALLOWED_WEB_TOOLS` must never be opened up on an
   unauthenticated deployment.
3. **Finish source governance where Python cannot reach:** resolve a cleared URL's *host* before
   fetch (private/link-local/loopback refusal), enforce per-domain request rate
   (`SearchStrategy.max_requests_per_domain_per_minute` exists and is now produced, but nothing
   consumes it), and decide **Q2** about the robots default with real hosts.
4. **Judge the ranking** (**Q1**) against live result sets once a Firecrawl key exists, then either
   set a relevance floor, add a Gemini rerank over ~8 candidates, or leave lexical as is.
5. **Provider backoff at the LLM layer** for 429/503 — the web layer now retries
   (`curation/retry.py`); the Gemini client still surfaces the error without retrying, which the
   free-tier ceiling makes a normal condition rather than an edge case.

Still open: **G1** (demonstration strategy), **G2** (needs a Firecrawl key — see §6 for what Phase 4
settled and what it did not), **B1** (a MySQL user), **L1** (enrichment-repo licence position — see
`docs/control/THIRD-PARTY.md`), **S1** (who writes site playbooks), and the two new Phase 5 gates
**Q1** (is lexical relevance adequate) and **Q2** (should unreadable robots keep refusing), both of
which need live web access to answer.

### Carried forward from Phase 2, still true

- The research graph is a **stateless in-process run**. It persists nothing, so the dataset phase
  must define how `ResearchResult` maps onto rows, columns, sources and evidence. The DTO already
  carries per-record sources with `verifiedByTool`, which is what field-level provenance needs.
- Graph bounds are configuration (`MAX_LOOPS`, `MAX_SEARCHES_PER_RUN`, `MAX_SCRAPES_PER_RUN`),
  supplied per request by Spring, range-validated at boot — so a planner can lower them per step.
- `POST /api/v1/research` is currently **unauthenticated** and guarded only by its schema check.
  Acceptable while nothing is stored and no live provider call happens by default; it must sit
  behind workspace-scoped authorization before any data lands.
- **R32** is the sharpest technical risk: the model names URLs, while robots / SSRF / rate-limit
  gating is the source-governance phase. Phase 4 sharpened it — a run can now *act* on a URL through
  a browser session, so `run_interact` additionally requires that the URL was already retrieved this
  run. Callers should still pass `allowedDomains` until Spring resolves hosts.
- The `collection` extra resolved cleanly on Python 3.14 (cp314 wheels exist); 3.12 remains the
  pinned deployment interpreter for reliability, not installability.
- `M` still lists gate 3 as a **Phase 8** exit criterion; it is implemented, so Phase 8 now owes
  only the wiring into a real collection run.

One environment note for anyone running the stack here: port **8080 is occupied by the old
project's** `ai-data-intelligence-platform-1.0.0.jar`. It is not part of FINALAIAGENT and was left
running; Phase 2 verified the live chain on `SERVER_PORT=8090`.

**Carried from Phase 1.5 into later phases:** extraction **gate 3** (completeness critique, bounded
on every path, exhaustion never reported as success) is added as an exit criterion of **Phase 8 —
Collection & extraction**, per `O` §O.9. The `O` §O.9 edits to `Architecture.md` and `Phases.md`
are pending, because both files are still to be written. **L1** should be settled before Phase 2
writes any code derived from `data-enrichment-js`.
