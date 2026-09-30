# Memory.md — Living Project Memory

### Project: FINALAIAGENT — AI-Powered Data Intelligence Platform

This file records **verified** state only. Every "works" claim must name the test or command that
proved it. Anything skipped, unverified or assumed is recorded in §5, not omitted. This discipline
exists because the previous project's memory file claimed authorization was active, that no `.env`
existed, and that the system was production-ready — each contradicted by its own source
(see `docs/audit/00-FORENSIC-AUDIT.md` §2, §3).

---

## 1. Current Status

- **Current Phase:** 17 — final cleanup, **complete**. The first phase to delete things: a stale 454 KB
  copy of `app/` under `ai-service/build/`, six dead models in `app/contracts.py` (including
  `CritiqueResult`, a phantom contract neither runtime honoured), one unused `Protocol`, three
  no-caller Java methods, **24 unused Java imports**, two unused Python imports, a `_not_blank`
  validator duplicated across two API modules (now one shared `PromptRequest`), the
  `@radix-ui/react-label` dependency, and the `verify.sh` class list that had been running 58 MySQL
  tests instead of 75. **P57, P64 and P70 closed; P54 untouched and still the top item.** Independence
  was proven by building, not by grep: the repo was cloned to a directory where no reference repository
  is a sibling, and it compiled and passed its suite there (§2 Phase 17.3). All gates green after the
  deletions: 330 backend tests (75 on real MySQL 9.6 across all five classes), 362 ai-service, frontend
  typecheck / lint / build. Nothing in the six reference repositories was modified or removed.
- **Previously:** 15 — final repository extraction, **complete**. An audit phase: no code was
  written, nothing was deleted, and the tree was byte-identical to Phase 12's commit. What it proved, in
  §2 (Phase 15): the six reference repositories are **removable** — no build, install or runtime path
  in this project reads them — and every feature the reuse map credits to them now carries a verdict of
  present, relocated or absent, with the eighteen findings recorded as **P54–P71 in §5 rather than
  quietly closed**. The one finding that changes behaviour, not paperwork, is P54: the robots fetch in
  `ai-service/app/curation/robots.py` is an outbound request from this service to an origin that a
  scraped page can influence, and no host-resolution guard exists in any of the three trees.
  **Phase 12** — Spring Security: identity, sessions and workspace authorization, **complete**, built
  on the Phase 11 operations surface. A request is now scoped to the workspace its
  session was issued against: `workspaces`, `users`, `workspace_members` and `auth_sessions` exist
  (`V5__baseline_identity.sql`), registration creates a person plus a personal workspace plus the OWNER
  membership that makes it reachable, and `FINALAGENT_WORKSPACE_ID` is **gone** — from the properties
  record, `application.yml`, `.env.example`, the startup validator and the test profile. Sessions are
  opaque random values checked by their SHA-256 against MySQL on every request, in an `HttpOnly
  SameSite=Strict` cookie, with rotation, family-based reuse detection and a database-clock lockout.
  **There is no JWT secret in this build at all**, so the requirement that the frontend never receive
  one cannot be broken by a later edit. **330 backend tests pass, 75 of them against real MySQL 9.6**;
  362 ai-service tests and the frontend gates pass unchanged. Verified over real HTTP as well as
  MockMvc: anonymous `GET /api/v1/datasets` → 401 envelope, register → 201 +
  `Set-Cookie: …HttpOnly; SameSite=Strict`, `GET /api/v1/auth/me` → 200, and the session value appears
  in no body. The web layer remains **mocked-only**: `FIRECRAWL_API_KEY` is still blank, so no real
  browser session, search, scrape or robots fetch has ever run from this project.
- **Last updated:** 2026-09-30
- **Application code written:** three independent processes.
  - `backend/` — Spring Boot 3.5.16, Java 21, Maven. 86 main source files, 32 test classes:
    `workflow/` (domain, repository, plan, execution, service, web), `quality/`
    (`DeclaredContract`, `RowContractEnforcer`), `dataset/` (domain, repository, service, web,
    export), `operations/` (history, activity, monitoring) and **`identity/`** (domain, repository,
    service, security, web) behind `config/SecurityConfig`.
  - `ai-service/` — FastAPI on Python 3.14 (3.12 pinned for deployment), 46 modules: config,
    contracts, security, logging, `api/v1/{health,research,requirements,quality}`, `llm/`,
    `firecrawl/`, `extraction/`, `requirements/`, `research/` (graph, tools, state, prompts, skills,
    contracts), `curation/` (canonical, relevance, ranking, policy, robots, retry, queries,
    aggregation) and `quality/` (contracts, normalize, validate, dedupe, entity_resolution, merge,
    score, pipeline).
  - `frontend/` — Next.js 14.2.35. PirateAgentUI design foundation copied byte-identically
    (`diff -r` verified), 10 routes, `lib/api/` typed client. **Untouched by Phases 9-12**: it still
    has no login screen and its eight dashboard routes still render their placeholder content, so the
    Phase 13 wiring is what makes this authentication reachable from a browser.
- **Runnable:** yes. `scripts/dev-backend.sh`, `dev-ai.sh`, `dev-frontend.sh` each start one
  process; `scripts/verify.sh` runs every suite, and as of Phase 17 its MySQL line matches
  `*MySqlTest` by name, so all five classes — all 75 — run in the gate rather than the four it used to
  name (P64, closed).
  **Run the MySQL suites with no second backend alive**: another process
  pointed at the same schema polls the same queue and will finish an export a test is mid-cancelling,
  which looks exactly like a product defect and is not one (P53).
- **Built:** the workflow planner and job engine, their schema and persistence, fetch-time source
  governance (robots + domain policy + ranking + dedupe), the six-stage data-intelligence pipeline,
  Java-side contract re-enforcement of the pipeline's answer, verified browser actions, the dataset
  platform with row- and field-level source traceability, the operations surface with three export
  formats, and identity — accounts, sessions, tenancy and the role ladder.
- **Still not built:** the frontend's connection to any of it (Phase 13), SSE streaming (events are
  persisted, cursor-paged and served as a feed, not pushed), export-file and session-row retention
  (nothing sweeps `var/exports` or old `auth_sessions` rows), host-resolution SSRF and per-domain
  rate — Phase 15 found the first of those reachable rather than merely absent (P54) — membership
  administration (roles are read and enforced; nothing changes them yet), and
  multi-workspace selection — a person with several workspaces is signed into their primary, and
  switching is not built.
- **Repository:** `FINALAIAGENT` is its own git repo, pushed to branch `implementjava` of
  `github.com/VishalRajExe/AI-Powered-Data-Intelligence-Platform.git` after every phase, per the
  standing rule. Its history is independent of `main` (old project), which has never been touched
  from here. Phase 12 is the next commit to make.
- **Blocked on:** decisions **G1**, **G2**, **S1**, **Q1**, **Q2** and the **L1** licence ruling
  (§6); Python 3.12 before the provider extra is installed. **B1 (the MySQL account) is resolved**
  and no longer blocks anything.

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

- [x] **Phase 7 (2026-09-29) — Spring Boot workflow execution. NO REDIS.** MySQL-persisted jobs,
      Spring `TaskExecutor` workers, conditional-UPDATE claim locking, leases with heartbeats, a
      sweeper for dead workers, retries with capped jittered backoff, step timeouts, cooperative
      cancellation, persisted progress and counters, and duplicate-job prevention enforced by the
      schema. Every number below came from a command run in this session.

  | Verification | Measured |
  |---|---|
  | Backend tests | `mvn test` → **185 tests, 0 failures, 0 errors, 0 skipped** with `FINALAGENT_TEST_MYSQL=true` (was 80 before this phase; without the gate 155 run and the same 30 report as skipped) |
  | Queue semantics on real MySQL | **14/14** in `WorkflowQueueMySqlTest`, MySQL **9.6.0** on 127.0.0.1:3306 |
  | Full run lifecycle on real MySQL | **16/16** in `WorkflowRunLifecycleMySqlTest` (end-to-end: API → run → jobs → worker → steps → status) |
  | Claim race | 8 threads, one job, **exactly 1 winner**; `attempt_count` 1, one `worker_id` |
  | Duplicate prevention | `UNIQUE (run_id, step_id)` and `UNIQUE (workflow_id, attempt)` both reject the second insert (returns false, row count stays 1) |
  | Lease recovery | expired lease → job back to `PENDING`, step back to `PENDING`, re-claimable by the next worker; with attempts exhausted → job and step `FAILED` with `LEASE_EXPIRED_EXHAUSTED` |
  | Lost-lease write | `writeTerminal` / `requeue` / `renewLease` all return **false** for the worker that lost ownership; the row keeps the new holder's state and no result is written |
  | Retry timing | `requeue(delay=60)` puts `scheduled_for`/`next_retry_at` 60 s out on the **database clock**; `findClaimable()` returns nothing until then |
  | Shutdown | `releaseLeasesHeldBy` returned 2 and both jobs became claimable immediately |
  | Backend jar | `target/backend-0.1.0.jar`, 29,862,362 bytes |
  | **Real process boot** | jar started with `WORKFLOW_EXECUTION_ENABLED=true`: Flyway connected to MySQL 9.6, **`workflow worker local:development:32276:… started (pool 8, lease 300s, poll 500ms)`**, `Started BackendApplication in 4.324 seconds` |
  | `/api/v1/ready` live | 503, honestly: `mysql UP`, `credentials UP`, **`workflowQueue UP` with `pendingJobs/runningJobs/activeRuns`**, `aiService DOWN (reachable:false)` because the Python service was not running |
  | `GET /api/v1/workflows/runs` live | 200 with `{"runs":[],"worker":{"freeSlots":8,"running":true,"inFlight":0,…}}` |
  | AI service | unchanged this phase: **245 passed, 8 skipped** |

  **This closes Phase 1's last exit criterion** (item 6, "a MySQL account the app can connect as").
  The account is `finalagent`, granted `ALL PRIVILEGES ON finalagent_dev.*` only, and the schema
  now holds the seven Flyway-managed tables plus `flyway_schema_history` (2 migrations). The rows
  written while verifying were deleted again; `SELECT COUNT(*)` on `workflows`, `workflow_runs`,
  `workflow_jobs`, `activity_events` is 0.

  Defects **in my own Phase 7 code** found by compiling and running, not by reading:

  | # | Defect | How it surfaced |
  |---|---|---|
  | P12 | **`failLeaseExhausted` used SQL `+` to join two string literals.** In SQL that is arithmetic, so MySQL answered `Data truncation: Truncated incorrect DOUBLE value` and the sweep could never fail a stranded job — the exact row the sweeper exists to fix. | `WorkflowQueueMySqlTest.anExpiredLeaseWithNoAttemptsLeft…` against real MySQL (SQLite and doubles never evaluate that expression) |
  | P13 | **`fk_runs_plan` had no cascade,** so deleting a workflow that had ever run was refused outright: the plan row is a parent of the run, and both cascade from `workflows`. No retention path, no delete, and the tests could not clean up. | `Cannot delete or update a parent row` on the first `@AfterEach`; fixed by `ON DELETE CASCADE` in `V2__execution.sql` and re-applying the schema |
  | P14 | **The shipped defaults contradicted the validator they ran into:** `step-timeout-ms` 240000 against `lease-seconds` 90, which `StartupRequirementsValidator` itself refuses ("step timeout must be shorter than the lease"). Enabling the queue with the documented defaults would have stopped the process at boot. | Writing `acceptsAConfiguredQueue` with the defaults from `application.yml` — it failed before any queue code ran. Lease default raised to 300 s in `application.yml` and `.env.example`, with the reason written next to the number |
  | P15 | **A successful terminal write erased the reason for the failed attempt** (`last_error_code = ?` with null), so a run that took three tries recorded nothing about why. | `aTransientUpstreamFailureIsRetriedAndTheRunStillCompletes…` expected `SERVER_ERROR`, got `null`; the write now `COALESCE`s the error columns |
  | P16 | **Both step handlers read the wrong payload key** (`researchRequest` / `validate` instead of `config`), so every real run would have failed with `STEP_CONFIG_MISSING` before calling anything. The unit tests caught it because they built the payload the way `PlanSteps.payloadFor` actually builds it. | `ExtractStepHandlerTest` / `ValidateStepHandlerTest` |
  | P17 | **The `VALIDATE` step re-added `recordsFound` and `recordsRaw` that `EXTRACT` had already counted,** so a two-step run would have reported double the records it collected. Counters are now owned by exactly one step type. | Reasoning against the DDL while writing `ValidateStepHandlerTest`; asserted by `theValidatorContributesOnlyTheVerdictsToTheRunCounters` |
  | P18 | **A failed run left its later steps `PENDING`,** reading as work still to come beside a `FAILED` run. The terminal rollup now cancels unstarted steps as well as unstarted jobs. | `aStepThatNeverSucceedsExhaustsItsAttempts…` |
  | P19 | **`ActivityRepository.forRun(runId, limit, afterId)`** had the cursor and the limit swapped relative to every caller's mental model; called with `limit=0` it silently returned nothing. Reordered to `(runId, afterId, limit)`. | `theStepThatRanRecordedWhatItProducedAndTheRunKeepsTheEventTrail` got an empty list despite four events being present |
  | P20 | **`ResearchResult.Validation` was missing five fields the AI service already sends** (`recordsWithoutEvidence`, `duplicateSourcesCollapsed`, `refusedSources`, `droppedCandidates`, and `Source.citedByRecords`), and Spring — with `FAIL_ON_UNKNOWN_PROPERTIES` disabled — dropped them silently. | Writing `ExtractStepHandler`, which needed the refusal counts; the wire-contract test now pins all of them, including that `refusedSources` is a list of **objects** while `recordsWithoutEvidence` is a list of **record indices** |
  | P21 | **Dead code from the first draft:** eleven repository methods nothing called (`findByStatus`, `isStepJobTerminal`, `hasUnfinishedForRun`, `runningJobCount`… , `markRunningAgain`, `cancelAllNotFinished`, `findNotFinished`, `countByStatus`, `countAll`, `reclaimExpiredLeases(int)`, `findExhaustedExpired`), plus `LeaseGuard.jobId()`, `StepContext.get()` and `WorkflowService.Created`. Each was a second way to do something that had a first way already. | `grep` for call sites before writing tests |

  Reuse records:

  | Repository | Source file | Feature | Destination | Method |
  |---|---|---|---|---|
  | _(none — Phase 7 is a port of this project's own audit, not of a reference repo)_ | `docs/audit/J-no-redis-job-architecture.md` §J.1-§J.13 | the whole queue design: four queue columns, the conditional-UPDATE claim, lease + heartbeat, sweeper, backoff formula, `REQUIRES_NEW` terminal writes, semaphore-gated claiming, shutdown lease release | `workflow/repository/JobRepository`, `workflow/execution/{WorkflowWorker,WorkflowJobExecutor,LeaseGuard,Backoff}`, `db/migration/V2__execution.sql` | **AUDIT → IMPLEMENTATION.** Every SQL statement carries the section it came from in its javadoc. Nothing here was taken from `anakin`, `web-agent-main` or `web-research-agent-master`: none of them has a persistent job queue (the first is in-process, the second delegates to Firecrawl's cloud run, the third is a synchronous script) |
  | old project (audit only) | `workflow-runner.ts:167-169` | emitting `EXPORT_NOT_IN_PHASE` placeholder steps for work the runner never implemented | — | **NO TAKE — and inverted.** `WorkflowPlanner` emits only `collect` and `validate`; `SAVE`/`EXPORT` are absent from the plan rather than present-and-skipped, so a plan cannot look complete while doing nothing |
  | old project (audit only) | `workflows.routes.ts:92` | progress synthesised from status (`COMPLETED→100, RUNNING→50, else 0`) | `RunRollup.derive`, `RunRepository.updateProgress` | **REPLACED.** Progress is the fraction of terminal steps, and the counters move by atomic SQL increments tied to the step transition that produced them |
  | old project (audit only) | `datasets.routes.ts:13`, `persistDataset` | client-supplied `workspaceId`; rows dropped when they lacked a verified source | `WorkflowService.workspace()`, `ValidateStepHandler` | **REJECTED.** The workspace comes from `FINALAGENT_WORKSPACE_ID` only, a foreign workspace id answers as not-found, and failing records are counted and reported, never deleted |

- [x] **Phase 8 (2026-09-30) — Data intelligence pipeline.** `Raw Result → Normalize → Validate →
      Deduplicate → Entity Resolution → Conflict Handling → Quality Report → Final Dataset`, running
      as one Python pass behind `POST /ai/v1/quality/process` and one Java verdict behind a new
      `TRANSFORM` workflow step. Source provenance survives every stage. Verified against five
      dataset types, not only startups. Every number below came from a command run in this session.

  The plan is now `collect → transform → validate` (`WorkflowPlanner.TRANSFORM_STEP`), and the split
  is the one `A` §A.2 promised: Python proposes, Java disposes.

  | Verification | Measured |
  |---|---|
  | Backend tests | `FINALAGENT_TEST_MYSQL=true mvn test` → **247 tests, 0 failures, 0 errors, 0 skipped** (was 185 after Phase 7; +62). Without the gate: 217 run, 30 report as skipped |
  | Queue + lifecycle on real MySQL | **30/30** still green, MySQL **9.6.0** on 127.0.0.1:3306, now over the three-step plan (`WorkflowRunLifecycleMySqlTest` 16/16, `WorkflowQueueMySqlTest` 14/14) |
  | AI service tests | `.venv/Scripts/python.exe -m pytest -q` → **349 passed, 8 skipped** (was 245/8; +104). Per file: pipeline 26, identity/dedupe/resolve/merge 27, normalize 20, validate 19, API 7, wire fixture 3, plus 2 new boot-bound checks in `test_config.py` |
  | Frontend | `npm run typecheck`, `npm run lint`, `npm run build` all pass — untouched by this phase |
  | Full gate | `FINALAGENT_TEST_MYSQL=true scripts/verify.sh` → 7/7 PASS |
  | Backend jar | `target/backend-0.1.0.jar`, 29,907,273 bytes |
  | Dataset types actually exercised | funded companies (currency + entity merge on email), job postings (salary parsing + a non-job flagged), YouTube channels (suffix expansion, URL identity), conference speakers (merge on email, **refuse** to merge on similar names), product SKUs (missing price never defaulted to 0), plus a parametrised "no record is dropped whatever its type" across all five |
  | Pipeline runs once per run | `TRANSFORM` is a single call; `SAVE`/`EXPORT` remain absent from the plan rather than emitted-and-skipped, so the legacy double-execution at `workflow-runner.ts:160,164` cannot reappear |
  | Nothing is dropped | asserted as arithmetic in `PipelineHandoffTest`: `rowsChecked + linkedDuplicates == records.size()` (4 + 2 = 6) on the real captured response |
  | Cross-language contract | `backend/src/test/resources/wire/quality-process.json` is generated by the pipeline and pinned on **both** sides: `ai-service/tests/test_quality_wire_fixture.py` fails if the Python output drifts from the committed file, `QualityWireContractTest` fails if Java's DTOs stop binding it |

  What the pipeline guarantees, each with a test naming it:

  - **Duplicates are linked, never deleted** (`duplicateOf` + `matchType`; the dataset keeps one row
    and the other record stays in the result pointing at it).
  - **Invalid records are rows too**, flagged with their issues, because the caller decides what a
    dataset may contain.
  - **Nothing is invented.** Ambiguous `79,90` and `05/11/2024` are kept as written with a note rather
    than guessed; a currency keeps its unit or has none; `confidence` is null when a record cites
    nothing — a zero would read as "weak evidence" when the truth is "none".
  - **Conflicts keep both values, both source lists, and the rule that chose** (`evidence-count`,
    `recency`, `canonical-position`).
  - **Provenance survives every stage**: merged canonicals carry the union of sources, and
    `rawValues` is kept beside `values` so a surprising value can be traced to the rule.
  - **A rule that could not be executed is a WARNING** (`RULE_NOT_EXECUTED`), never a silent pass.
  - **The score names its own formula** (`scoreBasis`, `scoreComponents`) because it is a heuristic
    over five measured ratios, not a measurement of truth.
  - **A stage that died is a `FAILED` entry**, not a missing number — except `normalize`, whose
    failure ends the run because there would otherwise be no records to report on.

  Java's re-enforcement (`quality/RowContractEnforcer` + `quality/DeclaredContract`) is a second
  opinion, not a copy: it reads the **plan's** typed field list, folds keys the way `fold_key` folds
  them, and reports a disagreement in both directions — `ADVISORY_PASSED_HERE_REJECTED` (the
  fabricated pass) and `ADVISORY_REJECTED_HERE_PASSED` (this gate being stricter than it needs to be).
  On the captured six-record run the two disagree once, exactly where the pipeline called a record
  valid whose only citation was never retrieved by a tool.

  Defects **in my own Phase 8 code** found by compiling and running, not by reading:

  | # | Defect | How it surfaced |
  |---|---|---|
  | P22 | **`RowContractEnforcer` reported only the first fault in a currency.** `{amount:"4.5M", currency:"usd"}` produced `CURRENCY_CODE` and swallowed the non-numeric amount, because `currencyFinding` returned on its first hit — so fixing the unit would leave a text amount in a numeric column with nothing said about it. Type rules now return a list. | `a_currency_amount_that_is_not_a_number_or_a_unit_that_is_not_iso4217_is_rejected` expected both codes and got one |
  | P23 | **The `TRANSFORM` step re-added `recordsFound` and `recordsRaw` that `EXTRACT` had already counted,** so a three-step run would report twice the records it collected — the same class as P17, reintroduced by the new step. It now owns exactly one counter: duplicates linked. | `a_completed_run_stores_the_pipeline_records…` asserted the row count in the summary and found the run totals inflated |
  | P24 | **`advisoryValidCount` in the `VALIDATE` summary read 0 for a pipeline that had reported 2.** The handoff re-parsed the *renamed* quality view (`advisoryValidCount`, not `validCount`) as a `Quality`, and Jackson silently filled the gap with a zero. The advisory counts are now read out of the view they came from instead of being reconstructed. | `theStepThatRanRecordedWhatItProduced…` against real MySQL, where the stored column showed `"advisoryValidCount": 0` |
  | P25 | **`DeclaredContract.fromFields` mis-registered a required field that was not in the plan's field list** — an add/remove/add sequence that left the key in `types` but out of `keys`, so it would have been reported as an undeclared extra on every row. Found by re-reading the method against its own test before running anything. | `a_required_field_the_plan_never_typed_is_required_and_type_unchecked` |
  | P26 | **The pipeline's record shape was being stored with renamed keys** (`isValid → advisoryValid`), which made the JSON column unreadable as the DTO the next step needed. `TRANSFORM` now stores the typed records exactly as the pipeline sent them and marks the verdict advisory in a separate summary key. | First draft of `ValidateStepHandler` could not reconstruct the records; caught while writing `the_records_are_stored_as_the_pipeline_sent_them…` |
  | P27 | **Test-side assumption, not product-side:** the wire fixture expected a null `confidence` somewhere in the response and found none, because every record I had written cited at least one source. The null case is a record that cites *nothing*, so the fixture needed that record. | `test_the_fixture_carries_every_shape_the_java_dto_has_to_bind`; the added record is now the `SOURCE_EVIDENCE` case Java's gate exists for |

  Environment fact worth remembering: **MySQL reformats stored JSON** (`{"k": v}` with a space after
  the colon), so an assertion on a JSON column must match keys and values, not the bytes Jackson
  wrote. Recorded in `theStepThatRanRecordedWhatItProduced…`.

  Reuse records:

  | Repository | Source file | Feature | Destination | Method |
  |---|---|---|---|---|
  | old project (`ai-data-intelligence-platform`) | `data-intelligence/NormalizationService.ts:4-15,147,211-225` | alias→canonical map, key folding, placeholder-becomes-absent, URL/date/phone/currency/number coercion, currency-field heuristic, `Intl.DisplayNames` country names, first-non-empty-wins with alias conflicts noted | `ai-service/app/quality/normalize.py` | **PORT + FIX.** `Intl.DisplayNames` (locale-dependent, untestable across environments) replaced by canonicalizing a place against **the spellings the requirement itself declared**; `rawValues` kept so every change is traceable; ambiguous values refused rather than resolved |
  | old project | `data-intelligence/ValidationService.ts:17,26-30,142` | per-record source-evidence check, REQUIRED/TYPE/URL/EMAIL/DATE/ENUM, `isValid` derivation, verification states, per-field confidence heuristic `min(0.7, 0.45+0.1*(sources-1))`, unimplemented rules downgraded to WARNING rather than passed | `ai-service/app/quality/validate.py` (advisory) + `backend/…/quality/RowContractEnforcer.java` (authoritative) | **PORT + REIMPLEMENT + MOVE.** The downgrade-rather-than-fake behaviour kept deliberately. The heuristic confidence replaced by evidence counts plus a documented formula. Audit `C` predicted `backend/…/dataset/RowContractEnforcer.java`; it lives in `quality/` because `dataset/` does not exist until persistence lands |
  | old project | `data-intelligence/DeduplicationService.ts:20` | deterministic blocking on the rule keys, EXACT vs NORMALIZED only, FUZZY_REVIEW excluded from auto-merge, duplicate→canonical links | `ai-service/app/quality/dedupe.py` | **PORT + FIX.** Added the block-size bound (`quality_max_block_size`, default 400) so one pathological key cannot become a quadratic scan, and an oversized block is *reported and left uncompared* rather than silently skipped |
  | old project | `data-intelligence/EntityResolutionService.ts:14,15,24,94-101,127-144` | name-field ordering rule, legal-suffix stripping, blocking on first-2-chars + normalized identifiers, Levenshtein ratio, threshold 0.94, merge **only** with a shared stable identifier | `ai-service/app/quality/entity_resolution.py` | **PORT + DEVIATION.** "Identifier required to merge" kept as the load-bearing rule — similarity alone yields `REVIEW_REQUIRED`, never a merge. **`rapidfuzz`/`commons-text` not adopted** (audit `C` suggested them): Levenshtein ratio is implemented in-house, because a compiled dependency for one bounded string distance is not worth it here |
  | old project | `data-intelligence/DataQualityService.ts:35-46,77-79` | the weight-soup score (`clamp(0.2+0.15+…-conflicts*0.1, 0.05, 0.95)`), 0.05 when not source-backed, and `rawRecordCount` falling back to the current length | `ai-service/app/quality/score.py` | **REPLACED.** Five measured ratios averaged with equal weight, and the score carries its own `scoreBasis` plus `scoreComponents`; `null` instead of a number when there is nothing to score. The raw-count fallback was the defect: the caller now supplies `rawRecordCount` and an absent one is reported as "any earlier loss is not visible here" |
  | old project | `workflow-runner.ts:160,164` | the whole quality chain executed at **both** the MERGE and the SAVE step | `workflow/execution/TransformStepHandler` | **PORT + FIX.** One pass per run, behind one step; the stages stay separately reported inside the response, which is the property that mattered |
  | this project | `ai-service/app/curation/canonical.py` | the URL canonicalizer the curation stage already uses | `ai-service/app/quality/normalize.py`, `dedupe.py` | **REUSED, not reimplemented.** One canonicalization for the whole service — the legacy project had three that disagreed |
  | `data-enrichment-js`, `data-enrichment-py`, `web-research-agent-master`, `web-agent-main`, `anakin`, `TheAgenticBrowser` | — | nothing was taken for this phase | — | **NO TAKE.** None of them has a normalization/entity-resolution/quality-scoring pipeline; `data-enrichment-js` persists whatever the model claims, which is the defect class this phase exists to close |

  Deliberate non-additions: no dataset tables at the time (persistence was still unbuilt, so the
  pipeline's output travelled through `workflow_steps.output_summary` and the handoff was tested as a
  JSON round trip — Phase 9 has since stored the dataset in tables, and kept that handoff), no
  `SAVE`/`EXPORT` steps, no embeddings or vector store for entity resolution, no second web engine,
  no `rapidfuzz`, and no LLM in the pipeline — it is pure CPU-bound Python behind a synchronous
  FastAPI handler so it runs on the threadpool rather than blocking the event loop.

  **Not verified, stated plainly:** the pipeline has only ever seen records that this project's tests
  constructed or that the mocked collection step produced. `FIRECRAWL_API_KEY` is still blank, so no
  real scraped record has passed through normalization, and three things remain unmeasured on real
  data: whether `entity_match_threshold = 0.94` is right for messy live names rather than tidy
  fixtures, how the pipeline behaves on a record set large enough for the block-size bound to
  actually bite (400 records per block is a reasoned number, never a measured one), and how long the
  synchronous pass takes in-process at 500 records — the step's 240 s budget and the quality client's
  socket patience are sized by reasoning about `stepTimeoutMs + 5000`, not by observation. The
  threshold and block bound are both overridable per request and validated at boot, so the first live
  run can narrow them without a code change.

- [x] **Phase 6 (2026-09-30) — browser planner / critique.** `TheAgenticBrowser-main` inspected; two
      of its patterns taken, its topology refused. **No second agent, no new runtime, no new
      dependency, no Java or schema change.** The loop the brief describes —
      `Planner → open source → interact → extract → critique result → retry/correct` — already existed
      in this service's one research graph as `plan_action → run_tools → schema gate → critique →
      feedback → loop`, bounded on every path since Phase 2. What it lacked was the two things
      AgenticBrowser is actually good at, and both are about distrusting a successful-looking answer.

  **Taken 1 — the action's effect is verified, not believed.** A browser session that answers is not
  a page that changed. `run_interact` now compares the session output against the content this run
  already held for that page (keyed by `canonical_key`, so a `?utm_` variant is the same page) and
  records `CHANGED` / `UNCHANGED` / `UNKNOWN` on `state.interactions`, in the tool message the
  planner reads next turn, and in the run metadata:

  ```
  [verification: the session returned the same content the page already had; the action may not have
  taken effect. Do not report this action as done. Either try a different action on this page, read a
  source that already states the value, or submit from what has actually been retrieved — do not
  infer the value the action was meant to reveal.]
  ```

  Deliberately weak in the flattering direction: a differing answer is reported as *changed*, never
  as *succeeded*, because text is all we have — upstream had a before/after screenshot pair and a
  second model instructed that "the Browser Agent will say the action was successful, but you have
  to visually confirm whether the text was actually entered"
  (`TheAgenticBrowser-main/core/ss_analysis.py:69`), and we will not pretend to pixels. Whitespace
  and case differences are normalised away first, so a re-render is not a state change
  (`test_text_that_only_reflowed_is_not_claimed_as_a_page_that_moved`). A second session on the same
  page is measured against where the first left it, which is the repeat the upstream loop could never
  see (`orchestrator.py:606-615` re-ran a failed step against the same plan forever, with `i` never
  incremented so every error logged as "step 0"). **And a run whose records rest on a session it
  cannot verify is never reported clean**: any `UNCHANGED`/`UNKNOWN` session makes the status
  `COMPLETED_WITH_WARNINGS` with the URLs named, because the critique is an LLM verdict and cannot be
  the thing that closes the doubt.

  **Taken 2 — the reviewer sees the evidence.** `critique_prompt` used to send a list of bare URLs
  plus the proposed JSON, which made it a plausibility check on the answer rather than a check of the
  answer against anything. It now sends, per source: how it was obtained, whether a tool returned it,
  a bounded excerpt of what was read, which contract field names appear in that text and which are
  absent, and any session's verification verdict. `critique.md`'s rules follow: a value must be
  attributable to quoted content, a search-snippet-only source supports nothing beyond its snippet,
  and a field name absent from every source is treated as evidence of invention. This is AgenticBrowser's
  `filter_dom_messages` (`orchestrator.py:99-132`) **adapted against its own bug** — that function
  blanks stale DOM payloads before critique, leaving the judge to score a submission against content
  it was told to forget. Nothing is blanked here; excerpts are bounded.

  Also taken, both small: per-node model-turn accounting (`metadata.turnsByNode`, from
  `orchestrator.py:187-214`), and acted-on provenance — the session prompt and id travel with the
  verification verdict, so a dataset row can say which page state produced it.

  **Refused.** The three-persona split (planner / browser / critique agents) — that is the second
  orchestrator `A` §A.1 was written to prevent. Playwright/CDP element control, indexed accessibility
  trees and `[mmid='N']` targeting (`get_detailed_accessibility_tree.py:40-55`) — there is no local
  browser here; Firecrawl's `interact` takes a natural-language action against a session we already
  budget and stop in a `finally`. Screenshot diffing. Prompt-encoded loop limits
  (`critique_agent.py:74-75`) — the graph's `StepBudget` already gates every path, and upstream has
  **no code-level bound at all**: `MessageType.MAX_TURNS_REACHED` is declared (`message_type.py:14`)
  and emitted nowhere, and give-up exits through the same `terminate=true` + `final_response` path as
  real success (`orchestrator.py:585-596`) — exhaustion reported as a normal answer, which is defect
  class this project's status rules exist to prevent. DOM pruning in the **submission** transcript —
  that is how a value gets lost.

  **Licence and safety position on this repository:** "TheAgentic Community License v1.0"
  (`LICENSE:19-22` bars offering it as a competing SaaS/PaaS; `:27-39` requires notices on modified
  copies; `:49-52` bars sublicensing). **No file was vendored or copied** — patterns only, so no
  notices are owed; `docs/control/THIRD-PARTY.md` keeps the standing record and gate **L1**.
  Three things in it were refused on safety grounds rather than architecture, and are recorded because
  they are the reason a project cannot adopt this repo wholesale: it launches Chromium with
  `bypass_csp=True` and `--disable-blink-features=AutomationControlled`
  (`browser_manager.py:219-221,250-252`) — detection evasion; its README tells users to reuse their
  real Chrome profile (`README.md:112`); and its browser agent is instructed that actions "may include
  logging into websites" with `#username`/`#password` fill examples (`browser_agent.py:36,140-144`)
  and carries **no refusal policy** — no CAPTCHA handling exists, but neither does a rule against it.
  Our safety literals (`allowAuthentication=false`, `allowCaptchaBypass=false`) are asserted to stay
  true in every plan; `test_the_correction_offers_another_source_and_never_a_way_round_a_wall` now
  checks the failure path's advice offers *another source*, and contains no login/password/captcha/
  bypass/paywall wording at all.

  | Verification | Measured |
  |---|---|
  | AI service tests | `.venv/Scripts/python.exe -m pytest -q` → **362 passed, 8 skipped** (was 349/8; +13 new in `tests/test_research_verification.py`) |
  | Backend tests | **247, 0 failures** with `FINALAGENT_TEST_MYSQL=true` — unchanged, because no Java file was touched; the new metadata keys ride the existing free-form `metadata` map and the warning rides `validation.warnings` |
  | Full gate | `FINALAGENT_TEST_MYSQL=true scripts/verify.sh` → 7/7 PASS (backend tests, package, MySQL queue 30/30, ai tests, frontend typecheck/lint/build) |
  | Regression | all 47 pre-existing research tests (`test_research_interact/graph/api`) pass unmodified — the graph's topology did not change |
  | Diff size | 5 files, +217/−9: `state.py` (`InteractionRecord`, `page_text`, `turns`), `tools.py` (verify + guidance), `prompts.py` (`evidence_text`), `prompts/critique.md`, `graph.py` (status rule, metadata) |

  Reuse records for this phase:

  | Repository | Source file | Feature | Destination | Method |
  |---|---|---|---|---|
  | TheAgenticBrowser-main | `core/click_using_selector.py:45-58`, `core/dom_mutation_observer.py:20-65` | a mutation observer wrapped around one action, so "I clicked it" is checked against "the page changed" | `ai-service/app/research/tools.py:_verify_interaction` | **ADAPT + FIX** — no DOM and no local browser here, so the observer becomes a text comparison against the page content the run already holds; and the upstream's false claim ("this means the action is not yet executed", emitted *after* a click that did run) is replaced by three honest verdicts, one of which is `UNKNOWN` |
  | TheAgenticBrowser-main | `core/ss_analysis.py:69,83`, `core/orchestrator.py:503-534` | a second model instructed not to believe the executor's success claim | `ai-service/app/research/prompts/critique.md` + `prompts.py:evidence_text` | **ADAPT** — the distrust is kept, the mechanism is not: it judged a before/after **screenshot pair**, and we have text. The reviewer now receives per-source excerpts, field-name presence/absence and the session verdict instead of a URL list |
  | TheAgenticBrowser-main | `core/orchestrator.py:99-132,135-167` (`filter_dom_messages`) | prune stale giant page payloads out of the replayed transcript | `ai-service/app/research/prompts.py:evidence_text` (critique turn only) | **ADAPT + REJECT half** — bounded excerpts for the reviewer, yes; the upstream version **blanks** the content the critique is meant to judge, which is not reproduced, and the submission transcript keeps every page whole because pruning there is how a value is lost |
  | TheAgenticBrowser-main | `core/orchestrator.py:187-214` | per-agent, per-step token accounting | `ai-service/app/research/state.py` (`turns`) → `graph.py:_metadata` (`turnsByNode`) | **PORT, reduced** — turn counts by node, not tokens: this service's LLM client does not report usage per call, and inventing a token figure would be exactly the kind of number this project refuses |
  | TheAgenticBrowser-main | `core/utils/dom_helper.py:21-45`, `click_using_selector.py:107,125` | return the opening tag of the element actually acted on | `ai-service/app/research/state.py:InteractionRecord` (prompt + session id + verdict, attached to the source) | **ADAPT** — there is no element to name; what a Firecrawl session can tell you it did is the prompt and the session, and that is what now travels into provenance |
  | TheAgenticBrowser-main | `core/utils/get_detailed_accessibility_tree.py:40-55,489`, `browser_agent.py:47,218` | indexed accessibility tree, model acts by `[mmid='N']` | — | **NO TAKE** — needs a local browser and a JS injection we cannot do through Firecrawl's `interact`. Its own renumber-from-`let id = 0` on every capture is a latent bug (a cached index silently points elsewhere after a re-render), which is the reason not to half-copy it |
  | TheAgenticBrowser-main | `core/orchestrator.py:23-48` (`ensure_tool_response_sequence`) | refuse a model turn whose tool calls have no matching responses | — | **NO TAKE** — we never replay provider-native tool-call pairs; the transcript is our own typed `Message` list and `RecordingLlm` calls are one-shot JSON, so there is no pairing to break |
  | TheAgenticBrowser-main | `agent/browser_agent.py:36,140-144`, `core/enter_text_using_selector.py:243-245`, `core/browser_manager.py:219-221,250-252`, `README.md:112` | login-form filling as a documented capability, `bypass_csp=True`, `--disable-blink-features=AutomationControlled`, reusing the user's real Chrome profile | — | **REFUSED on safety grounds** — credential entry and bot-detection evasion. Our plan literals stay `allowAuthentication=false`, `allowCaptchaBypass=false`, and the failure-path advice is now tested to contain no login/password/captcha/bypass/paywall wording |
  | data-enrichment-js | `graph.ts:155-225` (`reflect`) | the critique node and its router | already ported (Phase 2), unchanged | **ALREADY IN PLACE** — Phase 6 did not add a loop; it made the loop's two weakest links evidence-based |

  Defects found while doing this:

  | # | Defect | How it surfaced |
  |---|---|---|
  | P28 | **A nested-quote f-string with a misplaced closing paren** in `evidence_text` — `…never retrieved')}` — broke `app/main.py`'s import chain, so *every* test in the service failed to collect | `pytest tests/test_research_interact.py` → `ImportError while loading conftest … SyntaxError: f-string: unmatched ')'`. Python 3.14 does not forgive reused quotes inside an f-string; the fix computes the phrase first, which also made the line fit |
  | P29 | **The reviewer was blind by construction.** Discovered while writing the evidence test, not by a failure: `critique_prompt` interpolated `state.sources` as `- {url} ({source_type})`, so the "adequately evidenced" instruction in `critique.md` had nothing to check against and a fabricated value was invisible to the judge | Reading the prompt the test produced. Now asserted directly: `test_the_reviewer_is_shown_what_was_read_not_only_where_it_came_from` |
  | P30 | **A test-side invention:** the first draft of the `UNKNOWN` case forced `state.scraped_pages.add(...)` to manufacture the state, which is not how a run reaches it. The real path is a URL that arrived by search and was never read — the evidence rule admits searched URLs, so `UNKNOWN` is ordinary, not pathological | Caught by reading the gate in `run_interact` before finalising the test; the fabricated line is gone and the test states the actual path |

  **Not verified, stated plainly:** no live Firecrawl browser session has ever been driven from this
  project (`FIRECRAWL_API_KEY` length 0), so the verification's *usefulness* on real pages is
  unmeasured and its weakness is structural: real pages differ after an action for reasons that have
  nothing to do with it — timestamps, ads, pagination chrome, A/B shells — so `CHANGED` will be the
  common answer and says less than it appears to, while `UNCHANGED` is the only finding that reliably
  means something. `UNKNOWN` frequency depends on how often runs act on searched-but-unread URLs,
  which is a live-data question. The status rule errs toward reporting, so the first real runs will
  show whether this is noisy; the knob, if it is, is comparing on a normalised *subset* (the checklist
  fields) rather than the whole page, and that change should be made against observed sessions, not
  ahead of them.

- [x] **Phase 9 (2026-09-30) — dataset platform.** The MySQL-backed store a run's answer can live in,
      and the read surface over it. The plan's chain grew a fourth step —
      `collect → transform → validate → save` — and `SAVE` is in the plan only because there is now
      code that writes a dataset and a schema to write it into; `EXPORT` remains absent rather than
      present-and-skipped.

  | Verification | Measured |
  |---|---|
  | Backend tests | `FINALAGENT_TEST_MYSQL=true mvn test` → **288 tests, 0 failures, 0 errors, 0 skipped** (was 247; +41), of which **47 run against real MySQL 9.6** (`WorkflowQueueMySqlTest` 14, `WorkflowRunLifecycleMySqlTest` 16, `DatasetPlatformMySqlTest` 17) |
  | Migration | `V3__dataset_platform.sql` applied by Flyway to `finalagent_dev` on MySQL **9.6.0**; `flyway_schema_history` now holds 1, 2, 3 all `success=1`, and the schema has **14 tables** |
  | Dynamic schema | A job-posting run and a podcast-episode run saved through the same code produce different `dataset_columns` rows, and the episode dataset provably contains no `role_title` or `salary_amount` (`twoDifferentRunsProduceTwoDifferentSchemasFromTheSameCode`). **No field name for any entity appears anywhere in `dataset/`** |
  | Counts are the rows | Every header figure is re-read as a `COUNT(*)` of the table it describes — rows, valid, invalid, duplicates, sources, verified sources, conflicts, records-without-evidence — in one test (`everyCountOnTheHeaderEqualsTheCountOfTheRowsItDescribes`) |
  | Search / filter / sort / pagination | substring search over a stored `search_text`; filters `eq`, `contains`, `gte`, `lte`, `missing`, `present`; numeric vs text sort chosen from the column's declared type; `record_index` as tie-break so page 2 cannot disagree with page 1; `matchedRows` from a `COUNT(*)` of the same predicate |
  | Facets | min/max + operator list for `NUMBER`/`CURRENCY`, distinct values with counts while they stay under the bound, and `distinctListed: false` with the list withheld when a column is not a choice |
  | API | 9 endpoints: list, details, `schema`, `rows`, `search`, `filters`, `sources`, `sources/{id}/rows`, `evidence` (+ per-row `rows/{id}/evidence`) |
  | Replay | saving the same run twice replaces its dataset under the same id — rows 2 → 1, columns 4, row-source links 1, no orphans (`savingTheSameRunTwiceReplacesItsDatasetInsteadOfAddingASecondOne`) |
  | AI service | **unchanged this phase**: 362 passed, 8 skipped. The pipeline already returned typed records, columns and per-record sources; nothing in Python needed to move |
  | Frontend | typecheck, lint, build pass and are untouched — the dataset API is new read surface with no screen on it yet |

  **Schema, and the one thing about it that will bite.** Values are JSON, and filter and sort reach them
  through `JSON_EXTRACT(values_json, ?)` with the path **bound as a parameter** and the key resolved
  against `dataset_columns` first — so an injection-shaped sort key is a 400 that names the real
  columns, asserted against a live MySQL. The cost is honest and recorded: **a filtered or sorted read
  of a large dataset is a scan of that dataset's rows**, because no functional index can exist on a
  column nobody declared until the run finished. The upgrade path is per-dataset generated columns,
  which would mean DDL on behalf of a prompt; that trade was taken deliberately, not overlooked.
  `workflow_steps.output_summary` still holds the pipeline's intermediate answer (the save step reads
  the run through it), so Phase 9 replaced the *destination*, not the handoff.

  Defects **in my own Phase 9 code**, all found by running:

  | # | Defect | How it surfaced |
  |---|---|---|
  | P31 | **A foreign key can only reference an existing key in the exact column order.** `fk_dataset_workflow` said `REFERENCES workflows (id, workspace_id)`; `workflows` has `uq_workflow_scope (workspace_id, id)`, so MySQL refused the whole migration with error 6125. The fix also settled a convention: `datasets` carries `uq_dataset_scope (id, workspace_id)` so every child can say `REFERENCES datasets (id, workspace_id)`, the way `workflow_runs` already does | Flyway failing the boot of the MySQL test context. The half-applied `success=0` history row was then cleaned by hand — dropped seven empty tables the migration had not created and deleted the failed row, so Flyway owns V3 |
  | P32 | **`rows()` never bound the dataset id, and its ORDER BY dropped a parameter.** A sort on a JSON path puts a `?` in the `ORDER BY` clause, which sits between the WHERE parameters and the page window; the args list went WHERE → limit → offset. MySQL reported `No value specified for parameter 3` as "bad SQL grammar" | `a_linked_duplicate_is_stored_and_reachable…`. `predicate()` now owns the dataset scope as its leading parameter and `order()` returns its SQL *with* its args, so forgetting one is a type error rather than a runtime surprise |
  | P33 | **Two facet queries passed their parameters in reading order instead of statement order.** `SELECT MIN(CAST(… ? …)), MAX(… ? …) WHERE dataset_id = ?` was called as `(datasetId, path, path)`; the same mistake sat in the distinct-values query. `min`/`max` came back null and the value list was grouped against the wrong placeholder | `facetsDescribeWhatCanBeFilteredAndStopListingWhenAColumnIsNotAChoice` expected `60000.000000` and got `null` |
  | P34 | **The save step double-counted the run.** It contributed `validRowCount` to `records_valid` while the validating step had already added it, so a two-row run reported four valid records and a shortfall message read "collected 2 valid records against a required 5" where one had passed. `SAVE` now contributes **no** run-level counter: it is the step that writes tables, not the step that decides totals | `WorkflowRunLifecycleMySqlTest.aPromptBecomesAPlanARunFourSteps…` (expected 2, got 4) and `collectedButUnverifiedRecords…`. This is the same rule as P17/P23, found the same way — by running a longer plan |
  | P35 | **Dead and wrong in the first draft of `DatasetRepository`:** an overload that queried a column and then threw unconditionally, a call to a `JdbcTemplate` method that does not exist, and children inserted with the run id where the dataset id belonged | `mvn test-compile`, before any test ran |

- [x] **Phase 10 (2026-09-30) — source and evidence system.** Traceability made complete, on the same
      tables. Every row names its run and the step that wrote it; every page it cites is stored with
      its URL, domain, title, snippet, how it was reached (`search`, `scrape`, `interact`, or the
      combination in the order they happened), when it was retrieved and whether a tool returned it.
      Where a row and a page disagree, both values survive with their own source lists and the rule
      that chose.

  The five cases the brief names, each one a test:

  | Case | Test | What it proves |
  |---|---|---|
  | one row, one source | `oneRowWithOneSourceTracesToThatPageAndToNothingElse` | one source row, cited by that row; the URL-typed field gets real field-level attribution and `salary_amount` gets none |
  | one row, several sources | `oneRowWithSeveralSourcesKeepsAllOfThemAndCountsWhatEachOneSupports` | all three pages kept, `citedByRows` from the join, and the trace works from either end |
  | conflicting sources | `conflictingSourcesKeepBothValuesAndTheRuleThatChoseBetweenThem` | kept value, rejected value, both source lists and `resolvedBy` all survive the write and the read |
  | missing source | `aRowWithNoSourceIsSavedCountedAndNamedRatherThanLeftOut` | the row is saved, counted in `recordsWithoutEvidence`, listed by `/evidence` — kept and flagged, never dropped |
  | blocked source | `aBlockedSourceIsRecordedWithThePolicyThatBlockedItAndStaysUnverified` | a page refused before fetching is stored with `provenance=REFUSED_BEFORE_FETCH`, its policy code and reason, `verifiedByTool=false`, cited by no row |

  **No fabricated verification, and the one defect that tested for it.** Three rules hold at once: a
  page no tool returned keeps `verified_by_tool = 0` no matter how many rows cite it; field-level
  attribution exists only when the field's own value *is* that page's URL **and** a tool retrieved
  the page; and `coverage` reports a column's populated rows and its attributed rows as two numbers,
  because a field can be full of values and still trace to nothing.

  | # | Defect | How it surfaced |
  |---|---|---|
  | P36 | **The save step attributed a field to a page that no tool ever returned.** `rowOf()` checked only whether the value's hash was among the row's citations, so a model's invented `posting_url` earned a `DECLARED_SOURCE` edge — a fabricated verification, written by the layer whose job is to refuse them | `aCitedPageThatNoToolReturnedNeverArrivesAsVerifiedEvidence`, the only failure in the first full run of the dataset suite. A citation is not a trace, and the query now requires the source's own `verifiedByTool` before it writes one |
  | P37 | **`canonicalHash("")` returned the SHA-256 of nothing**, so every URL-less citation would have collapsed into one shared source row keyed on the empty string | `aSourceWithNoUrlIsNotHashedIntoSomebodyElsesPage` expected blank and got `e3b0c44…`. Blank now stays blank, the builder refuses to key a source on it, and the count is reported as `sourcesWithoutUrl` rather than the citation vanishing |
  | P38 | **Tenant scoping turned out to be structural, not polite.** Moving a dataset's `workspace_id` was refused by MySQL, because its children reference `(dataset_id, workspace_id)` — so a header cannot be re-homed away from the rows that inherit its scope. Found as a broken test, and kept as an assertion | `unknownIdsAnswerAsNotFoundAndAForeignWorkspaceCannotBeProbed`: what began as a shortcut in the test (update the workspace, then probe) is now the thing being asserted, and the foreign dataset is created under the other workspace properly |

  Reuse records for these two phases:

  | Repository | Source file | Feature | Destination | Method |
  |---|---|---|---|---|
  | old project | `workflow-execution.repository.ts:255-300` (`persistDataset`) | writing collected records into typed dataset tables | `dataset/repository/DatasetRepository`, `workflow/execution/SaveStepHandler` | **PORT + REVERSAL.** Upstream `continue`d past rows whose sources did not hash-match a persisted `Source` (`:271-272`), so a dataset landed short with no explanation anywhere. Here an invalid row is stored with its issues, an unevidenced row is stored and *counted*, and a duplicate is linked rather than deleted |
  | old project | `data-intelligence/AgentResultNormalizer.ts:41-49` | a URL counts as evidence only if a tool returned it this run | `dataset/service/DatasetAssembler.rowOf`, `dataset_sources.verified_by_tool` | **PORT + STRENGTHENED.** Upstream used the flag to decide which rows to keep (and dropped them silently). Here it decides what may be *claimed*: the row survives either way, and P36 is the case where the strengthened rule caught the weaker reading |
  | old project | `dataset-field.service.ts`, `DatasetColumn` in the Prisma schema | columns as rows, so a dataset's shape is data | `dataset_columns` (`field_key`, `type`, `required`, `position`, `origin`) | **PORT + FIX.** The old schema declared column *types* but the write path filled them from a startup-shaped template. `origin` is new: it separates a field the plan declared from one a page happened to contain, which is what makes "dynamic schema" checkable rather than asserted |
  | this project | `ai-service/app/quality/merge.py`, `contracts.py` | conflicts with both values and both source lists, duplicate links, per-record provenance | `dataset_conflicts`, `dataset_rows.duplicate_of_row_id`, `dataset_row_sources` | **PERSISTED, NOT REIMPLEMENTED.** The pipeline already produced all of it; Phase 9 gave it somewhere to live and Phase 10 made it queryable from both ends |
  | this project | `ai-service/app/curation/canonical.canonical_key` | URL identity for dedupe | `DatasetAssembler.canonicalize` (Java) | **DELIBERATE SECOND IMPLEMENTATION, for a different question.** Python's canonicalizer decides whether two records are one entity; Java's decides which stored source a row's value names. Both are documented as such, because the failure this project is built to avoid is *three* canonicalizers that silently disagree about one question — here each owns one |
  | anakin, web-agent-main, web-research-agent-master, data-enrichment-js, ai-data-enrichment-agent, TheAgenticBrowser-main | — | nothing | — | **NO TAKE.** None of the six has a dynamic dataset store or a field-level evidence model; `data-enrichment-js` persists whatever the model claims, which is the defect this phase exists to close |

  **Not verified, stated plainly for both phases:** every dataset row tested here was assembled from
  fixtures this project wrote, so what is proven is the *plumbing* — schema derivation, counts,
  pagination, FK scoping, and the refusal to upgrade a citation into a trace. Not proven: how wide
  the filter surface needs to be once real prompts produce real column counts (a `TEXT` column of
  4,000 distinct descriptions is a facet that returns nothing useful, and `distinctListed: false` is
  the honest answer rather than a tuned one), what `search_text LIKE '%…%'` costs at 10,000 rows per
  dataset (unmeasured — no run has collected at that scale), and whether `position` ordering survives
  a schema where the model legitimately puts a field nobody asked for first.

- [x] **Phase 11 (2026-09-30) — operations: history, activity, monitoring, and three export formats.**
      Workflow, run and step history, an activity feed, one monitoring summary, and CSV/JSON/XLSX exports
      written by the same MySQL-backed queue that runs steps — no Redis, no second job system, and no
      progress number that was not measured. `EXPORT` enters as a *job type*, not as a fifth step:
      nothing about it is invented to fill a plan, and a run's status is not moved by a file somebody
      downloaded from it afterwards.

  **An export is a job, not a request.** `V4__exports_and_monitoring.sql` adds `export_jobs`, and the work
  it describes is a `workflow_jobs` row with `job_type = 'EXPORT'` and `step_id NULL` — one table, one
  claim, one lease, one heartbeat, one sweeper, one retry policy for every piece of asynchronous work in
  the service. `WorkflowJobExecutor.run` now dispatches on job type. The `EXPORT` branch keeps the lease
  guard, the `stillOwning` check and the guarded `REQUIRES_NEW` terminal write, and does **no** run
  rollup: an export reads a dataset a run produced, it is not a step of it, and its outcome must not move
  that run's status or progress. The branch has no timeout wrapper, which is a stated difference from a
  step rather than an oversight — a step's budget exists because it waits on an external service that may
  never answer, while an export waits on the database and the local disk, both already bounded by their
  drivers. The lease is what stops a wedged export, and a second timer on top would mostly succeed in
  cutting off a large job that was making real progress. Priority 200 keeps exports behind steps
  (100+sequence) in the same claim order.
  
  **Progress is measured, never narrated.** `total_rows` is a `COUNT(*)` taken in `ExportService.request`
  — on the request thread, before a job exists — which is also what rejects a filter naming a column the
  dataset never declared as a `400` rather than as a job that fails minutes later. `written_rows` advances
  only by rows physically handed to a writer. `ExportRepository.advance` is the **only** percentage writer
  in the build: it derives the figure from those two counts and caps at 99 until the record is completed,
  so 100 is unreachable while work remains and no caller can submit a share it has not earned. There is no
  code path that accepts a progress value from outside.
  
  `ExportProgressMySqlTest` makes the middle of a run observable instead of asserting only its end: the
  supplier the runner calls at every chunk boundary reads the record back, so five rows at the test
  profile's chunk of two are *seen* at `0, 2, 4` written and `0, 40, 80` percent, each below 100, with 100
  arriving only once `written = total = 5`. That is the specific inversion of the project this build
  replaced, which mapped status to a percentage (`RUNNING → 50`) so a job wedged for twenty minutes looked
  half finished.
  
  **Nothing half-written is ever visible.** Each writer streams into `<name>.part`; the file is renamed
  only after `finish()`, and the published name, byte count and SHA-256 go on the row. The download re-
  derives the path from the export id — the stored `file_path` is a record of where the writer put it, not
  an input — and sends the digest as `X-Content-Sha256` so a caller can check what arrived against what
  was measured. CSV carries a UTF-8 BOM (without it Excel reads the file in the local code page and every
  non-ASCII value arrives mangled), CRLF and RFC 4180 quoting. JSON carries the dataset meta, the columns
  *with their `origin`*, and each row's sources and issues — provenance is the reason that format exists.
  XLSX goes through POI's SXSSF with numbers written as numbers. All three are asserted by reading the
  bytes back, the workbook through POI itself.
  
  | Verification | Result |
  |---|---|
  | `mvn -B -ntp test` with `FINALAGENT_TEST_MYSQL=true` | **307 tests, 0 failures, 0 skipped** — all four MySQL classes ran |
  | `ExportWriterTest` (5) | BOM/CRLF/doubled-quote bytes; the formula guard on `=`, `@`, `+` and *not* on `12 % off`; JSON columns parsed back with `origin` intact; XLSX read through POI with `CellType.NUMERIC` preserved, a label header rather than a field key, and a blank absent cell; an empty dataset still producing a header-only file that says so |
  | `ExportProgressMySqlTest` (11) | progress at chunk boundaries `0 → 40 → 80` then 100; a claimed job run by the real executor and downloaded with a matching digest; mid-write cancel leaving 4 rows, 66 %, `CANCELLED` and neither file nor `.part`; a lease taken over producing no terminal write and exactly one `lease_lost` event; `EXPORT_TOO_LARGE` at `max-rows + 1` refusing with both counts named; cancel moving the record *and* its unclaimed job, leaving nothing claimable; a reclaimed job over a finished export skipped so one checksum cannot describe two files; `salary:gte:70000` read the ordinary way (3 rows) and exported as exactly those 3; an undeclared filter key refused before any row existed; `409 EXPORT_NOT_COMPLETED` versus `404 EXPORT_NOT_FOUND`; and the monitoring/history surface asserting every run status present including the zeros, `recordsFound` equal to the sum of its rows, dataset totals equal to `COUNT(*)`, `runCount` and `latestPlanVersion` per workflow, step history with its job attached, and an activity cursor that pages to empty |
  | `StartupRequirementsValidatorTest` (25) | the export block added: a blank directory named in the refusal, a chunk larger than the ceiling refused, the ceiling's own bounds, and every pre-existing rule still passing |
  | `DatasetPlatformMySqlTest` / `WorkflowQueueMySqlTest` / `WorkflowRunLifecycleMySqlTest` | 17 / 14 / 16 — unchanged after the executor dispatch, the `cancelPendingForRun` scope and the shared filter parser |
  | `scripts/verify.sh backend` | green: tests, package, and the MySQL check, which now names all four classes instead of two |
  | Secrets in the commit set | none — Java, SQL, YAML, one `properties` file, `pom.xml` and `verify.sh`; the export directory lives under the existing `exports/` ignore rule |
  
  **Defects found and fixed in this phase.**
  
  | # | Defect | How it surfaced | Fix |
  |---|---|---|---|
  | P39 | **The download resolved its path from a system property nothing in this build sets.** `ExportService.file()` read `System.getProperty("finalagent.export.dir")` while the writer honoured `FINALAGENT_EXPORT_DIR`, so a configured deployment would write to one directory and offer files from another | Reading the wiring while adding the `EXPORT` branch — the two paths had to agree, and they did not | the path is re-derived from the export id through the runner's own `fileFor`, so one method decides where a file lives, and the stored path is a record rather than an input. A row someone had edited can no longer name a file the process can read |
  | P40 | **Every JSON export of a real dataset failed on the first row.** `rowSources` returns `retrievedAt` as a `java.time.Instant` and `JsonFile` serialized through a bare `ObjectMapper`, which refuses JSR-310 types — the provenance block, which is the entire reason the format exists, was what it could not write | `theClaimedJobRunsThroughTheExecutorAndItsFileIsDownloadable` went `FAILED` with `InvalidDefinitionException`, while the direct-runner test (CSV) passed. A unit test of one format hid a fault in another | the writer serializes through a mapper carrying `JavaTimeModule` with `WRITE_DATES_AS_TIMESTAMPS` off, so a timestamp in a file is the same ISO string the read APIs print |
  | P41 | **A refusal left two answers to one question.** `EXPORT_TOO_LARGE` and `DATASET_NOT_FOUND` failed the *job* while `export_jobs` still said `QUEUED`, because only the I/O path wrote the record | The ceiling test asserted `FAILED` and read `QUEUED` | both paths now write the record and the job with the same code and the same sentence |
  | P42 | **The CSV formula guard sat inside the quoting.** `=HYPERLINK(…)` became `"'=HYPERLINK(…)"`: Excel reads a quoted cell as text anyway, so the apostrophe survived as visible content and the guard was decoration rather than protection | `ExportWriterTest` comparing the exact cell bytes | quoting is applied to the value and the apostrophe is prefixed *outside* it, which is where Excel reads it as "this cell is text" rather than as data |
  | P43 | **The runner silently overrode its own configuration**: `Math.max(50, chunkRows)` meant a deployment asking for a row at a time got fifty, and a test profile at two rows per chunk saw one checkpoint for the whole file | Reading the config through: `StartupRequirementsValidator` already bounds the chunk between 1 and 10 000 and refuses one larger than the ceiling, so the floor duplicated a rule that had a home | the clamp is gone; the validator is the one place the bound lives |
  | P44 | **Cancelling a run cancelled somebody's export.** `cancelPendingForRun` moved every PENDING job of the run, and an export job carries that run id for traceability | Reading the new job type against the existing statement | scoped to `job_type = 'WORKFLOW_STEP'`. An export is a reader of a dataset the run produced, not work the run still owes |
  | P45 | **The XLSX writer would have buffered the whole workbook in memory** to measure it, defeating the reason SXSSF was chosen | Reading `finish()` before it shipped: a `ByteArrayOutputStream` sized to the file, then copied | the workbook is written straight through the counting stream, so the byte figure is the file's size and memory stays at the chunk |
  | P46 | **A run-history index ordered on a random UUID.** `idx_runs_workflow_recent (workspace_id, workflow_id, id DESC)` would serve a listing that looks sorted to the database and arrives in no order a human can read | Reading V4 before Flyway ever applied it — the same mistake the export listing made, caught in the same pass | runs and exports order by `created_at` (with `id` as a stable tie-break); activity keeps `id`, which does increase, and is therefore also a safe cursor |
  
  Also corrected before it shipped: `JsonFile` called a `JsonFactory.createGenerator` overload that does not
  exist, and `Xlsx` referenced an unimported stream. Both were compile errors rather than defects, and both
  are listed here only because the phase's files had not been compiled until the branch was wired.
  
  **Two structural changes that belong to this phase rather than to exports.**
  - `config/Workspace.java` makes "the workspace comes from server configuration and never from a request"
    one component instead of one private method per service. A duplicated security rule drifts, and this one
    is the rule the audit's §5 item 1 says the old project broke.
  - `DatasetQueryRepository.Filter.parse` owns the `key:operator:value` grammar, and `DatasetController`
    calls it rather than holding its own copy. An export is requested with the scope of the listing it came
    from; two parsers of one grammar become two behaviours, and the stored scope would stop meaning what the
    rows endpoint means.
  
  **Endpoints added.** `POST /api/v1/datasets/{id}/exports` (`202`, queues, never writes on the request
  thread), `GET /api/v1/exports`, `GET /api/v1/exports/{id}` (with its job row — lease, attempts, last
  error, the queue's own words rather than a paraphrase), `GET /api/v1/exports/{id}/download`,
  `POST /api/v1/exports/{id}/cancel`, `GET /api/v1/workflows`, `GET /api/v1/workflows/{id}/runs`,
  `GET /api/v1/workflows/runs/{runId}/steps`, `GET /api/v1/activity` (cursor on the event id, plus an
  `action` prefix filter) and `GET /api/v1/monitoring`. A step's history names the job that ran it because
  the step row holds only the *latest* outcome — a step that failed twice before succeeding is invisible
  unless both rows are read together. Every run status appears in `monitoring`, including the zero ones, so
  "none" is never read as "not counted"; queue depth is labelled `queue-wide` because the worker pool is
  shared and a per-workspace number would imply an isolation that does not exist.
  
  Reuse records for this phase:
  
  | Repository | Source file | Feature | Destination | Method |
  |---|---|---|---|---|
  | old project | `export.service.ts:41-53` | generating a file inside the HTTP request and holding the job in a promise | `dataset/service/ExportService.request` (row + job, then return), `dataset/export/ExportRunner` | **REVERSAL, not port.** Upstream's state lived in the process that started it, so a restart stranded every export in `RUNNING` with nothing able to recover it. Here the queue owns the work and every reader reads what it recorded |
  | old project | `event-broadcaster.ts:56-99` | write the event, then broadcast it | already adopted in Phase 7; `OperationsService.feed` is the cursor reader over that log | **PORT (reader side).** The streaming endpoint the audit deferred is now a `SELECT … WHERE id > ?` over a table that already exists, which is why SSE stayed out of this phase rather than being half-built |
  | this project | `docs/audit/J-no-redis-job-architecture.md` §J.1-§J.13 | conditional-UPDATE claim, lease, heartbeat, sweeper, guarded terminal write | `workflow_jobs` rows with `job_type='EXPORT'`, dispatched by `WorkflowJobExecutor.runExport` | **REUSED AS IS.** No second queue, no new lock, no Redis. The one deliberate deviation is the absent timeout wrapper, documented above with its reason |
  | Apache POI | `poi-ooxml:5.4.1`, `SXSSFWorkbook` | writing an OOXML workbook without holding it in memory | `ExportWriter.Xlsx` | **NEW DEPENDENCY, TAKEN.** Writing the zip package by hand is a bug farm; the justification and the streaming requirement are recorded in `pom.xml` beside the coordinate |
  | anakin, web-agent-main, web-research-agent-master, data-enrichment-js, ai-data-enrichment-agent, TheAgenticBrowser-main | — | nothing | — | **NO TAKE.** None of the six has an export pipeline that survives a restart; `anakin` and `data-enrichment-js` generate files in-request the way the old project did, which is the defect this phase inverts |
  
  **Honest limits after this phase.**
  1. Exports are readable only through the API's own directory and **nothing sweeps old files**. The
     `ON DELETE CASCADE` comment in V4 anticipates a retention rule; it is not implemented, so disk growth
     is an operator concern until it is.
  2. A large export occupies a worker for its duration. Intended (priority 200, bounded pool, lease
     reclaim), but unmeasured here: every dataset in this build is a handful of rows, so "how long does a
     200 000-row XLSX take, and does it starve steps" is still a question rather than a number.
  3. `monitoring` is a set of point-in-time reads. There is no time series, so "is it slower than usual"
     cannot be answered from it.
  4. Everything here is still unauthenticated and single-workspace by configuration — Phase 12's task, and
     made more urgent by this one: `POST /api/v1/datasets/{id}/exports` both starts billed-adjacent work and
     hands back a file of another tenant's rows the moment tenancy is real.

- [x] **Phase 12 (2026-09-30) — Spring Security: identity, sessions and workspace authorization.**
      Registration, login, logout, refresh, current user, and the tenancy that every previous phase
      had faked with one configured workspace. `V5__baseline_identity.sql` adds `users`, `workspaces`,
      `workspace_members` and `auth_sessions`, and gives `workspace_id` / `created_by_id` /
      `actor_id` / `requested_by_id` the foreign keys the audit said they needed — 35 referential
      constraints across 19 tables now, verified by trying to violate one.

  **`FINALAGENT_WORKSPACE_ID` is deleted, not deprecated.** It was in the `Execution` record, the
  startup validator, `application.yml`, `.env.example`, the test profile and three services; every read
  of it is gone, and a test asserts the record has no `workspaceId` component to add back. Keeping it
  as a fallback would have been the demo-mode shape this rebuild exists to remove: a request that
  reaches a tenant-scoped service without a session now raises
  {@code Workspace.NoSessionException} instead of being quietly granted somebody's data.

  **No JWT, so there is no JWT secret to leak.** A session is 32 random bytes; MySQL stores its
  SHA-256 and every request looks the row up. The brief's rule — the frontend must never receive the
  signing secret — is satisfied by construction rather than by care, and logout is a row delete
  instead of a request that a stateless claim honour. Rotation revokes the presented row and writes a
  child in the same `family_id`; **a revoked row presented again ends the whole family**, and that
  check lives in the request filter, not only in the refresh endpoint, because a copied token is
  useful to its holder on every route. Refresh and logout are deliberately reachable without a *live*
  session — that is their purpose.

  **A state change has to carry `X-Requested-With`.** Spring's CSRF filter is off, and the reason is
  a real defect found over HTTP rather than in MockMvc: with `HttpOnly` cookie auth and Spring 6's
  lazily-written token, a browser that had never asked for a token was given a session cookie and
  nothing else, so every correctly-behaving frontend `POST` would have failed closed while a
  hand-written curl got through. The header is checked for presence, not value — its job is to be
  something a cross-origin form cannot send without a CORS preflight, and the preflight is answered
  only for the exact origins `FRONTEND_ORIGIN` names. `SameSite=Strict`, the preflight and the header
  all have to fail together before a forged state change reaches the queue.

  **The role ladder is enforced where work is spent.** Reads are open to any member. Creating a
  workflow, starting a run, requesting an export and cancelling need EDITOR, because each one spends
  credits, quota, a worker or somebody else's in-flight work; a VIEWER gets 403 and the row count
  afterwards is the assertion that the refusal did not also do the work.

  | Verification | Measured |
  |---|---|
  | `mvn -B -ntp test` with `FINALAGENT_TEST_MYSQL=true` | **330 tests, 0 failures, 0 skipped** (was 307; +23), of which **75 run against real MySQL 9.6** across five classes |
  | `AuthenticationMySqlTest` (17, new) | registration creates person + personal workspace + OWNER membership and a session that works; two accounts created seconds apart cannot read each other's workflow, dataset, schema, rows, evidence or export by id (each answers as not-found, while the owner's own read answers 200); rows written by an authenticated request name the person who asked, and no `workflow.created` event is attributed to the machine any more; the cookie carries `HttpOnly`/`SameSite=Strict`/`Path=/` and the token appears in **no** response body while the database holds only its digest; rotation replaces the credential and a rotated-away token presented later ends the family; an expired access window still renews and a past absolute ceiling never does; logout ends one session and leaves the same person's other device signed in; **five refusals — unknown address, wrong password, locked account, disabled account, the seeded service actor — are byte-identical**; the lockout is a column on the database clock and the correct password does not beat it; a duplicate address leaves no partial account and no orphan workspace; a 12-character floor and a 72-byte ceiling are enforced with the value never echoed; every data endpoint 401s anonymously with the JSON envelope while `/health` and `/ready` still answer; a VIEWER reads and cannot write; the configured AI-service and database secrets appear in none of six endpoint bodies; and a row pointing at a workspace that does not exist is refused by MySQL |
  | Real HTTP, not MockMvc | booted on a spare port and driven with `curl`: `GET /api/v1/datasets` → 401 `AUTHENTICATION_REQUIRED`; register → 201 with the `Set-Cookie` flags above; `GET /api/v1/auth/me` → 200 with the caller's own workspace; the token in no body. **This is how P51 was found** — MockMvc had been passing `.with(csrf())` for a token no browser ever receives |
  | `DatasetPlatformMySqlTest` / `ExportProgressMySqlTest` / `WorkflowQueueMySqlTest` / `WorkflowRunLifecycleMySqlTest` | 17 / 11 / 14 / 16 — all still green after the tenancy source moved, now provisioning their tenant row and binding a principal; the readiness report's `workspaceIdConfigured` assertion was inverted to `doesNotExist`, which is what keeps the placeholder from returning |
  | `StartupRequirementsValidatorTest` (29) | session bounds refused, and two structural tests: the queue's config has no `workspaceId`, and no record component anywhere in the configuration is named like a secret |
  | `scripts/verify.sh` | all seven checks green: backend tests, package, MySQL queue (five classes), ai tests 362 passed / 8 skipped, frontend typecheck, lint, build |
  | Secrets to the frontend | no `NEXT_PUBLIC_` variable holds any value; `BACKEND_ORIGIN` stays server-side behind the rewrite; `X-Workspace-Id` removed from the CORS allow-list so no header can name a tenant; `/api/v1/*` bodies carry no credential |

  **Defects found and fixed in this phase.**

  | # | Defect | How it surfaced | Fix |
  |---|---|---|---|
  | P47 | **The failed-login counter was rolled back by the exception that reported the failure.** `login()` is `@Transactional` and refuses a bad credential by throwing, so the `UPDATE` that incremented `failed_logins` was undone with everything else — the lockout could never engage, in production, forever. | `theLockoutIsDataAndTheRightPasswordDoesNotBeatIt`: the row still read `locked_until IS NULL` after the budget was spent | `recordFailedLogin` runs in its own transaction (`REQUIRES_NEW`). The general lesson is in the javadoc: a counter written on a path that ends by throwing is a counter that never increments |
  | P48 | **Rotation ignored the absolute ceiling.** The child inherited the deadline only when it happened to be read; nothing stopped a session past `absolute_expires_at` from being renewed, so the ceiling that exists to end a long-lived stolen token moved forward forever. | `anExpiredWindowStillRenewsButAPastCeilingNeverDoes`: the second refresh answered 200 | the ceiling is part of the guard on the statement that revokes the parent, so the rotate is a no-op once it has passed |
  | P49 | **Refresh required a live session, which is the one thing it cannot have.** An expired-but-never-revoked credential was refused at the authorization layer before the endpoint could renew it, and logout was reachable only by someone still signed in. | The same test answered 401 where 200 was due | refresh and logout are permitted without a live session and validate the presented token themselves |
  | P50 | **Reuse detection only existed in the refresh path.** A rotated-away token presented on any other route was silently treated as a bad cookie, so theft was noticed only when the real user happened to renew. | `aRefreshRotatesTheCredentialAndAnOldTokenComingBackEndsTheWholeFamily` found zero `TOKEN_REUSE` rows | the check moved into the request filter, keyed on `revoke_reason = 'ROTATED'` — a logged-out row has no live sibling to protect |
  | P51 | **The CSRF design could not work for a browser at all.** With `HttpOnly` cookie auth and Spring 6's lazily-written token, a client that had never asked for one got a session cookie and no token, so every frontend `POST` would fail closed — while `curl`, which MockMvc and the tests resembled, sailed through. | Booting the real service and driving it with `curl`, where MockMvc had been green | Spring's CSRF filter is off and replaced by the `X-Requested-With` requirement, with the three compensating controls and the residual gap written into `SecurityConfig` |
  | P52 | **The filter chain could not be assembled twice-anchored**: ordering a filter relative to another custom filter is not a registered position. | `IllegalArgumentException: The Filter class SessionCookieFilter does not have a registered order` at context startup | both guards anchor on registry filters (`SecurityContextHolderFilter`, `BasicAuthenticationFilter`), which is also what puts the state-change check before authentication |
  | P53 | **Not a product defect, and worth recording as a verification hazard.** A second backend left running against the same dev schema claimed an export job mid-test and completed it, which read as a cancellation bug and as two "flaky" lifecycle tests. | The runner's own first checkpoint saw `written_rows=6, status=COMPLETED`; the job row named a *different* worker id, and `netstat` named the PID | the process was stopped, the test profile's lease raised to 30s with the reason, and the hazard recorded above and in §7 |

  Reuse records for this phase:

  | Repository | Source file | Feature | Destination | Method |
  |---|---|---|---|---|
  | old project | `auth.service.ts`, `jwt.strategy.ts`, the seeded `demo@pirateagent.ai` | registration, login, a signed request | `identity/service/AuthenticationService`, `identity/security/SessionCookieFilter`, `config/SecurityConfig` | **PORT + INVERSION.** Upstream minted a JWT and shipped a seeded account whose specialness lived in the login branch. Here the credential is opaque and revocable and the non-human actor is a column (`password_hash IS NULL`, `status='SERVICE'`) that the login path refuses before it compares anything |
  | old project | the routes that read `req.headers['x-workspace-id']` | naming the tenant a request works on | nothing — deleted | **REFUSED.** The audit's §5 item 1. `X-Workspace-Id` is gone from the CORS allow-list so the mistake cannot be reintroduced by a header, and a `Workspace` test asserts the config field does not come back |
  | this project | `docs/audit/00-FORENSIC-AUDIT.md` §5 item 2 | "workspace_id / created_by_id need their foreign keys" | `V5__baseline_identity.sql` | **CLOSED.** The tenants and actors that already appear in the data are materialised into `workspaces` / `users` first, so the constraints can exist without inventing a row the migration had no evidence for |
  | Spring Security | `BCryptPasswordEncoder`, `SecurityFilterChain`, `OncePerRequestFilter` | password hashing, the filter chain, a state-change guard | `config/SecurityConfig`, `identity/security/*` | **DEPENDENCY TAKEN, SUBSET USED.** Only the chain, the encoder and one filter are used; no form login, no http basic, no OAuth client — each would add an endpoint this API does not have |
  | anakin, web-agent-main, web-research-agent-master, data-enrichment-js, ai-data-enrichment-agent, TheAgenticBrowser-main | — | nothing | — | **NO TAKE.** None of the six has a tenancy model; `data-enrichment-js` and `ai-data-enrichment-agent` both ship a single shared credential for all users, which is the state this phase removes rather than adopts |

### Phase 15 — Final repository extraction (2026-09-30)

**Instruction:** inspect all six reference repositories one final time; for every useful feature
identify source file → logic → FINALAIAGENT destination → verify implementation; leave no required
runtime functionality dependent on the reference folders; search this project for old repository paths,
external local imports, accidental hardcoded paths, demo dependencies and dead dependencies; **do not
delete them yet**.

No code was written and nothing was deleted. Two things had to be proven separately, because they are
often conflated: that the reference folders are **removable**, and that this project **contains** what
it claims. The first is true, and mechanical to check. The second is true for everything this build
claims to do and false for eighteen things its own documents describe — those are P54–P71 in §5, and
they are gaps in this project, not dependencies on somebody else's.

**15.1 — the independence sweep.** Every search ran over `FINALAIAGENT` with build output and `.venv`
excluded.

| Searched for | Result |
|---|---|
| The six sibling repository names, in any source, config, script or manifest | ~20 hits, **all provenance comments** in Python module docstrings (`app/config.py:97,123`, `curation/{aggregation,canonical,policy,queries,relevance,retry,robots}.py`, `extraction/schema_validate.py`, `firecrawl/client.py`, `research/{graph,prompts,skills,tools,state}.py`) plus `README.md:281-282` and `docs/`. **Zero imports, zero paths, zero build inputs** |
| Absolute local paths — `D:\`, `D:/`, `/Users/`, `/home/`, `C:\Users` | **Zero** in tracked files. The only hits anywhere were inside `.venv`, i.e. third-party packages |
| Relative escapes out of the project (`../<repo>`, `../../`) | The only `../` in a dependency-bearing file is `deploy/docker-compose.yml:36,84,130` and `database/docker-compose.yml:7`, pointing at **this project's own** children (`../ai-service`, `../backend`, `../frontend`) as build contexts, and `ai-service/app/config.py:53` `env_file=(".env", "../.env")`, which is the repo root's own `.env`. `ai-service/tests/test_skills.py:211` contains `"../outside.md"` and `"sites/../../outside.md"` — a fixture asserting the traversal guard **refuses** them |
| Editable / path installs: pip `-e`, `file:`, `path=`; Maven `systemPath`; npm `link:`/`file:` | **Zero** in `ai-service/pyproject.toml`, `backend/pom.xml`, `frontend/package.json` |
| Symlinks (`find FINALAIAGENT -type l`) | **Zero** |
| Docker reads outside the build context | None. Each Dockerfile COPYs within its own directory; `deploy/docker-compose.yml:24-25` mounts a **named volume**, not a host path |
| Scripts and CI | No `.github/`. `scripts/*.sh` resolve `$ROOT_DIR` as their own parent only (`verify.sh:13-14`); no script opens a sibling directory |
| `.internal/agent-core-py` (the vendored Python core the audit rejected) | Referenced only in `docs/audit/*` and this file's decision log, as the thing that was **not** taken. No loader, no path, no copy |
| Demo mode | `DEMO_MODE` appears in **no file**. The only "demo" strings in production code are refusals: `diagnostics/ConfigurationFailureAnalyzer.java:20` and `ai-service/app/config.py:3`. The old project's `demo/` tree, seeded credential and simulator were never brought across |
| Dead dependencies | `@radix-ui/react-label` (P70) is the only one that cannot become live. Every Maven and Python dependency is imported by real code — including `httpx`, which no module imports directly but which `fastapi.testclient` requires, and `python-dotenv`, which `config.py:53` needs for `env_file`. The eight unreferenced `components/ui/*` wrappers are Phase 13's primitives, not waste |

**Verdict:** the six reference repositories can be deleted and `FINALAIAGENT` still builds, tests, boots
and runs. That was the instruction's threshold and it is met. `docs/control/THIRD-PARTY.md` asserted it
per row; it is now asserted per tree, by search rather than by claim.

**15.2 — what the feature-by-feature pass found.** `docs/audit/C-repository-reuse-map.md` names a
planned destination for every ported feature. Most landed under a different path because the phases
moved logic between layers; a handful never landed. Confirmed present, with the live call path checked
rather than the file's existence:

| Feature (source) | Where it actually is | Proof it is reachable |
|---|---|---|
| Atomic MySQL claim, lease, heartbeat, sweeper, DB-clock backoff, cancellation, lease-lost guard (the durability layer anakin *lacks*, designed in `J`) | `JobRepository.java:153-168` (conditional UPDATE on `status`+`version`+`scheduled_for<=NOW(6)`), `:178-184` heartbeat, `WorkflowWorker.java:151-171` sweeper, `Backoff.java:28-36`, `LeaseGuard.java:41-63` | 75 tests against real MySQL 9.6, including 8 threads claiming one row for exactly one winner |
| Terminal writes survive their own context (anakin `processor.go:24-33`) | `WorkflowJobExecutor.java:107-109` — `TransactionTemplate`, `REQUIRES_NEW`, 5 s timeout | the timeout test's row still reads `FAILED` after its step transaction is gone |
| Per-step timeout that interrupts, not post-hoc | `WorkflowJobExecutor.java:258-268` (`future.get(stepTimeoutMs)` then `cancel(true)`); `StartupRequirementsValidator.java:181-189` refuses `stepTimeoutMs ≥ leaseSeconds` | startup rejects the misconfiguration, so a step budget cannot outrun its lease |
| Requirement contract: Python produces, Java re-validates (old `requirement.schema.ts`) | `requirements/schema.py:26-174` + `contracts.py:89-136`; `RequirementValidator.java:44-114` | on every pipeline request (`PipelineController.java:71,102`, `WorkflowService.java:133`) |
| Safety floor as server constants, not model output (old `workflow-plan.schema.ts:61-64`) | `WorkflowPlanner.java:157-160`; behaviour in `curation/policy.py:125-131` | enforced at fetch time (`tools.py:198-201,317-321` → `state.refuse` → `DatasetAssembler.java:98`); `ResearchRequest` carries no field a model could relax |
| Bounded correction loop, then fail closed (old `planner.service.ts:45-80`) | `requirements/service.py:87-103`, bound = `max_schema_repairs` (`config.py:88`) | the requirement path re-injects its own issue list; the plan path needs none because Java writes the plan |
| Anti-fabrication gates: no submit without tool data, schema-gated output, bounded repair (`agent-core/src/agent.ts:37-130`) | `graph.py:188-196` (gate 1, `state.has_tool_data()` at `state.py:286-289`), `graph.py:200-217` (gate 2, repair ≤ 3) | `extraction/gate.py` never existed; the gates are in the graph, which is the only executor |
| One validator, three uses (`schema-validate.ts`) | `extraction/schema_validate.py`, called at `graph.py:126,200,261,286,295,381-383` and `llm/client.py:64` | prompting, runtime gate and post-run assessment all read the same function |
| Tool-observed-URL rule (`AgentResultNormalizer.ts:41-49,169`) | sources enter only through `state.observe` (`state.py:247-263`, called from `tools.py:169,222,344`); Java `RowContractEnforcer.java:335-347` + `DatasetAssembler.java:176-189` | **Nuance worth keeping:** `verified_by_tool` defaults to `True` (`state.py:74`) and is never assigned `False` outside tests. The rule holds by *exclusion* — a model-named URL never enters the list — not by the tri-state flag the old code carried. Enforcement is stronger; the DTO is less expressive |
| Interact hard timeout, null-stripping, no `interact` in fan-out (`toolkit.ts:51-102`, `worker/index.ts:61`) | `firecrawl/client.py:380-386,467-470`, `strip_interact_nulls()`, the `tools.execute_many` refusal | ported at Phase 4; still the only seam to the SDK |
| SKILL.md loader, domain index, traversal guard (`skills/{parser,discovery,tools}`) | `research/skills.py` | 24 tests; ships zero playbooks (gate **S1**) |
| Curation: canonicalization, lexical relevance with a floor, per-domain candidate cap, robots fail-closed, capped jittered retry, deterministic aggregation (`get_relevant_urls.py`, `web_scraper.py`, `result_aggregator_tool.py`) | `curation/{canonical,relevance,ranking,robots,retry,aggregation,queries,policy}.py` | weights `relevance.py:26-29` with the floor at `:114` enforced by `ranking.py:112-116`; robots cap `:35,162` and fail-closed `:122-141`; jitter `retry.py:115-118` |
| Six-stage quality pipeline (old `data-intelligence/*.ts`) | `quality/{normalize,validate,dedupe,entity_resolution,merge,score,pipeline}.py` behind `POST /ai/v1/quality/process`, executed as `TRANSFORM` | real order at `pipeline.py:53-77`; Java consumes at `TransformStepHandler.java:78-127` and re-enforces at `ValidateStepHandler.java:69-93` |
| Silent row loss fixed — skipped rows counted (old `workflow-execution.repository.ts:271-272`) | `SaveStepHandler.java:112-121` → `datasets.records_without_evidence` (`DatasetRepository.java:130`) | `DatasetDraft.java:109,113,143-147` carries the count into the row |
| Streaming exports with path containment (old `export.service.ts`, `export.repository.ts:122-128`) | `ExportWriter.java` (RFC4180 + formula guard `:58-65`, SXSSF `:216`), `ExportService.java:132-133` (`startsWith` after `normalize()`), name derived from ids only (`ExportRunner.java:227-231`) | 11 MySQL export tests, including a multi-checkpoint progress run and the row ceiling |
| Session-based tenancy; no client-named tenant (old `auth.middleware.ts`, defined and unmounted) | `SessionCookieFilter.java:105-115`, `Workspace.java:34-38` (throws, never defaults), `SecurityConfig.java:121-122` | proven over real HTTP with `curl` — which is how P51 was found |
| Fail-fast on a missing credential (old `env.ts`, which did not treat absence as fatal) | `StartupRequirementsValidator.java:36-80`, placeholder markers refused at `:88-100` | `ConfigurationFailureAnalyzer.java:20` prints the reason instead of starting a degraded process |

Confirmed **not** in this tree, each recorded rather than papered over: SSRF and DNS resolution (P54),
per-domain rate enforcement (P55), inbound rate limiting (P56), the Python `WorkflowPlan` contract is
unwired (P57), `parent_job_id` and `retry_count` are dead columns (P58, P59), snippet-containment
verification (P60), the pre-LLM content gate and per-domain policy store (P61), the VERIFY step and any
Java-side replan cap (P62), SSE (P63), and the seven smaller findings (P64–P71).

**15.3 — reuse record for this phase.** Nothing was taken, so the honest row is a negative one:

| Repository | Source file | Feature | Destination | Method |
|---|---|---|---|---|
| all six | — | nothing | — | **NO TAKE.** This phase read their trees and this project's and moved no logic in either direction |
| `web-agent-main`, `data-enrichment-js-main`, `ai-data-enrichment-agent-main`, `web-research-agent-master`, `TheAgenticBrowser-main`, `anakin-master`, the old project | their own source files, re-opened | verification of the claims in `C` and `O` | `docs/control/Memory.md` §5, P54–P71 | **AUDIT.** Seven of the reuse map's planned paths never existed (`governance/*`, `provenance/*`, `monitoring/ActivityAction.java`, `api/RunEventController.java`, `engine/*`, `extraction/{gate,schema}.py`, `app/llm/prompts/*`); the logic either lives under a phase-chosen name or was never built. `C` is a plan of record, not an inventory — §5 is now the inventory |

**15.4 — what this phase does not prove.** It proves absence of *references*, not absence of *need*: an
anakin-shaped capability could still be missing without anything here noticing. The functional proof is
Phase 16's entire job. It also did not re-run the suites: the tree is unchanged since the Phase 12
commit, so that phase's green gates still describe it. And P54's severity is reasoned, not demonstrated —
with no `FIRECRAWL_API_KEY` here, no attacker-influenced robots fetch has actually been made against a
metadata endpoint. It is reachable by inspection; it has not been observed.

### Phase 17 — Final cleanup (2026-09-30)

**Instruction:** remove temporary files, debug files, unused code, duplicate implementations, obsolete
demo code, unnecessary dependencies and machine-specific paths; remove nothing production requires;
verify the project builds independently and does not need the old project folder; verify the reference
repositories' required logic is inside `FINALAIAGENT`; do not delete the reference repositories.

This is the first phase since Phase 1 that **deletes**, so every removal is listed with the reason it
was safe and the gate that proved it. Nothing went out on the strength of a single grep.

**17.1 — what was removed.**

| Removed | Where | Why it was safe |
|---|---|---|
| A stale 454 KB copy of `app/` (46 `.py` files) under `ai-service/build/`, plus `finalagent_ai_service.egg-info/`, `.pytest_cache/` and every `__pycache__/` | untracked, but on disk | `build/lib` was an old `bdist` leftover that **already cost this project a wrong finding**: Phase 15's "the prompt templates are not packaged" claim was partly fed by the stale `egg-info/SOURCES.txt`, which lists no `.md` and predates every module in `app/research/`. The editable install was checked first — `__editable___…_finder.py` references neither directory — then they were removed and `pytest` re-run: 362 passed |
| `StepType`, `PlanStep`, `WorkflowPlan`, `ExtractedRecord`, `QualityRecord`, `CritiqueResult` | `ai-service/app/contracts.py` | **Closes P57.** Zero references outside the removal closure itself. `CritiqueResult`'s fields (`terminate`, `final_response`, `decision`) appear in no other Python file and in no Java DTO — `ResearchResult` carries `critiqueSatisfactory` / `critiqueReasons` built from graph state instead, so the class was a **phantom contract neither side honoured**. `RetryPolicy`, `RETRYABLE_ERRORS` and `SearchStrategy` were **not** removed: `config.py:260-262` and `curation/queries.py:60` use them |
| `InteractiveWebTool` (a `Protocol` no signature used) | `ai-service/app/firecrawl/client.py` | `supports_interact()` duck-types the capability and is the only mechanism; the protocol merely decorated it. `WebTool`, `Interaction`, `Page`, `SearchHit` all stay in use |
| `ExportRepository.findByJob`, `DatasetDraft.hasValidRows`, `SessionTokens.looksLikeSession` | `backend/…/dataset`, `identity/` | Zero call sites in main **or** test. `validRowCount()` — which `hasValidRows` wrapped — is used in eight places and was kept |
| **24 unused import lines across 8 files** (14 in `ExportRow.java` alone) | `backend/src/main/java` | `ExportRow` still carried CSV/JSON/XLSX writer imports from before the Phase 11 split that moved the writers into `ExportWriter`. Proved by recompiling and running all 330 tests |
| A duplicated validator: `_not_blank` existed **identically** in two request models | `ai-service/app/api/v1/{requirements,research}.py` | Replaced by one `PromptRequest` base in `app/contracts.py` that both inherit; the two files' then-unused `pydantic.Field`, `field_validator` and `CamelModel` imports went with it. This was the only *same-language* duplicate a body-hash scan of the whole service found |
| `from typing import Any` in `quality/score.py`; `LlmOutputUnparsable` in `requirements/service.py` | `ai-service/app` | Each used at its own import line and nowhere else |
| `@radix-ui/react-label` | `frontend/package.json`, lock, `node_modules` | **Closes P70.** `components/ui/label.tsx` is a hand-rolled `<label>` importing no Radix primitive, and nothing imports the wrapper. `typecheck`, `lint` and `build` all pass without it |
| The gate's stale class list | `scripts/verify.sh:53` | **Closes P64.** It named four `*MySqlTest` classes while five existed, so `AuthenticationMySqlTest`'s 17 identity tests were never run by `verify.sh`. Now `-Dtest='*MySqlTest'` — matched by name, so the next integration class is in the gate the day it is written. Verified: **75 tests across 5 classes, BUILD SUCCESS** |

**17.2 — what was found and deliberately left.** Each was a candidate; each failed the test for a
different reason, and writing that reason down is what stops the next cleanup re-litigating it.

- **The eight unreferenced `components/ui/*` primitives, `common/pagination` and
  `common/status-badge`.** Unimported today — and Phase 13's instruction is to preserve PirateAgentUI's
  cards, dialogs and badges exactly. They are the design system the wiring is about to use.
- **`PhasePlaceholder` in eight dashboard routes.** It is the honest current content of those screens,
  not demo content: it states that the endpoint is not wired yet. It leaves when Phase 13 replaces it.
- **Three SHA-256 sites** — `Json.shortHash` (string), `SessionTokens.store` (string),
  `ExportRunner.checksum` (**streaming**, 8 KB buffer). The first two overlap by six lines; each throws a
  different platform-guarantee message ("required by the plan hash" vs "required to store a session
  token"), and collapsing them would merge two guarantees to save eight lines in code where a mistake is
  an auth bug. Left, with the difference now written down.
- **`FieldDef` (requirement contract) vs `FieldSpec` (quality request).** Different boundaries with
  deliberately different strictness — `FieldDef.type` is a `FieldType` enum, `FieldSpec.type` is a
  permissive `str`. Merging them would change what `/ai/v1/quality/process` accepts from Java.
- **Dead columns `workflow_jobs.parent_job_id` and `workflow_steps.retry_count` (P58, P59).** Removal is
  a migration, and a column is schema, not code. The second is the more urgent of the two for a different
  reason: it is *published* as `retryCount` and always 0 — a correctness decision (write it, or stop
  returning it), not a cleanup.
- **`httpx` and `python-dotenv`** in `pyproject.toml`: imported by no module, required by
  `fastapi.testclient` and by `env_file=` respectively. Both stayed.

**17.3 — independence, proven by building rather than by grep.** Phase 15 proved the absence of
references textually; this phase repeated it as an experiment. `implementjava` was cloned into a temp
directory **where none of the six reference repositories is a sibling**, the working-tree changes were
applied there, and it was built in place: `mvn -o test-compile` → success; `pytest` (with `PYTHONPATH`
pointed at the copy and `import app` confirmed to resolve there rather than to the original) → **362
passed, 8 skipped**. A sweep of the copy found 26 mentions of the reference repositories, all in Python
module docstrings at lines 3-5 — **zero** in Java, TypeScript, TSX, JSON, TOML, YAML or shell, and zero
inside any `import`, `open`, `Path()` or subprocess call. **`FINALAIAGENT` does not require the old
project folder to build, test or run.** The copy was then deleted; the six reference repositories were
**not** touched and are not deleted.

**17.4 — the state after cleanup.** Backend 330 tests, 0 failures / 0 errors / 0 skipped, with all five
`*MySqlTest` classes against real MySQL 9.6 (75 of the 330). ai-service 362 passed, 8 skipped (live
provider and live Firecrawl, still no key). Frontend `typecheck` clean, `lint` 0 errors with 5
pre-existing `react-hooks/exhaustive-deps` warnings, `next build` emitting all ten routes. Zero
machine-specific paths in tracked code or config (`C:\Users`, `D:\`, `/Users/`, `/home/`, any username:
none); no debug leftovers (`System.out`, `print(`, `console.log`, `TODO`, `FIXME`, `XXX`, `HACK`: none in
main source); no stray `.orig`/`.rej`/`.bak`/`.tmp`/`.part` files anywhere in the tree.

**17.5 — what Phase 17 did not close.** The reference logic audit stays as Phase 15 recorded it: what
this build needs is inside it, and **P54 (host-resolution SSRF, with `curation/robots.py` making the
unguarded outbound call today) is untouched** — a cleanup phase must not be the phase that quietly
decides a security control. Still open after this phase: P54, P55, P56, P58, P59, P60, P61, P62, P63,
P65–P69, P71. Closed by it: P57, P64, P70.

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

| 2026-09-29 | **Phase 7: the job queue is MySQL, not Redis, and the lock is one conditional `UPDATE`.** | `UPDATE workflow_jobs SET status='RUNNING', worker_id=?, lease_expires_at=TIMESTAMPADD(SECOND,?,NOW(6)), attempt_count=attempt_count+1, version=version+1 WHERE id=? AND status='PENDING' AND version=? AND scheduled_for<=NOW(6)` returns 1 row for exactly one caller. InnoDB evaluates the predicates and writes the new values in the same statement, so there is no window between "check" and "take" for another node to slip into. Measured: 8 threads, 1 winner. `SKIP LOCKED` is neither needed nor used: the version predicate already makes the second claimer a no-op, and it works on any MySQL rather than 8.0+ only (`J` §J.2) |
| 2026-09-29 | **Time belongs to the database.** Every lease, backoff and scheduling instant in `JobRepository` is `NOW(6)` or `TIMESTAMPADD(…, NOW(6))`; the application clock is never consulted. | Two app nodes with clock skew would otherwise disagree about who owns a job, and that disagreement looks exactly like a stuck queue. Proven where it matters: `requeue(delay=60)` puts `scheduled_for` in the future on the *server's* clock and `findClaimable()` then returns nothing |
| 2026-09-29 | **A worker that lost its lease writes nothing — twice over.** The executor re-reads `worker_id AND status='RUNNING'` before opening its terminal transaction, and the write itself carries `WHERE worker_id = ? AND status = ?`. | If a lease is retaken mid-step, two workers hold answers for one step, and whichever wrote last would otherwise win arbitrarily while the run's counters absorbed both. Verified by `aWorkerWhoseLeaseWasTakenOverCannotWriteAnything`: `writeTerminal`, `requeue` and `renewLease` all return false for the dispossessed worker and the row keeps the new holder's state |
| 2026-09-29 | **Terminal state is written in a `REQUIRES_NEW` transaction with a 5 s timeout.** | By the time a timeout or a cancellation is recorded, the step's own context is finished, and a write made inside it would be rolled back along with it — which is how the reference implementation left rows "stuck in processing forever" by its own admission (`J` §J.6) |
| 2026-09-29 | **Duplicate work is refused by the schema, not by a check-then-insert:** `UNIQUE (run_id, step_id)`, `UNIQUE (run_id, step_key)`, `UNIQUE (workflow_id, attempt)`. | Two nodes can both pass "does this job exist?" before either inserts. `insertStepJob` and `RunRepository.insert` catch `DuplicateKeyException` and return false, so the loser of the race reads the winner's row instead of creating a second execution |
| 2026-09-29 | **Step-job claiming is gated by a semaphore, not by the pool's queue.** | A claimed job whose lease is ticking while it waits behind 200 queued others is a job that gets reclaimed and run twice — the exact failure the lease exists to detect. `WorkflowWorker` takes a permit per claim and releases it when the job finishes |
| 2026-09-29 | **A lease that expires with attempts left is revived; one that expires with none is failed loudly,** together with its step row. | Reviving forever would hide a worker that cannot finish; leaving it `RUNNING` would look like work in progress indefinitely, which is how the old export jobs stranded. Both branches live in `WorkflowWorker.reclaimExpiredLeases` and both are tested against MySQL |
| 2026-09-29 | **Shutdown releases our leases** — stop claiming, drain in-flight up to `min(30, lease)`, then `releaseLeasesHeldBy(workerId)`. | The difference between a redeploy that resumes in seconds and one where every in-flight job waits out its lease. The test asserts both rows return to `PENDING` with `lease_expires_at` cleared |
| 2026-09-29 | **The step timeout wraps the handler on a separate invoker thread; it is not a value the handler is asked to respect.** | A call blocked on a socket never checks a deadline, so `Future.get(stepTimeoutMs)` reclaims the job regardless. What the timeout *cannot* do is abort the HTTP request already in flight — Firecrawl exposes no run-level abort — so the recorded message says that out loud instead of implying the call was cancelled |
| 2026-09-29 | **`WORKFLOW_STEP_TIMEOUT_MS` must be shorter than `WORKFLOW_LEASE_SECONDS`, enforced at startup.** | If a step can outlive its lease, two workers run one step on purpose rather than by accident. Writing the rule found that the shipped defaults broke it (P14), which is the argument for having it |
| 2026-09-29 | **Cancellation is cooperative, and a `RUNNING` step is never rewritten by the cancelling request.** | Only its worker knows what it is in the middle of. `cancel` sets `cancel_requested_at`, cancels *pending* jobs and *pending* steps, and lets the in-flight worker notice at its next boundary; handlers check `cancelRequested()` before spending anything. Stamping a live row `CANCELLED` would create a row claiming an outcome no thread ever wrote |
| 2026-09-29 | **Counters move by atomic SQL increments tied to the step transition that produced them, and each counter has exactly one owner.** | `records_raw`/`records_found` belong to `EXTRACT`, `records_valid`/`duplicate_count` to `VALIDATE`. Read-modify-write would race across concurrent steps, and a shared "records found" field would double-count (P17). A replayed or lease-lost write adds nothing, because the step write it hangs off returns false |
| 2026-09-29 | **Progress is derived from step states and nothing else.** | The replaced project synthesised `COMPLETED→100, RUNNING→50, else 0` (`workflows.routes.ts:92`), so a run wedged for twenty minutes looked half-done. `RunRollup.derive` floors `terminal/total`, so a two-step plan reports 0, 50, 100 as its steps actually finish |
| 2026-09-29 | **A shortfall against the plan's `minimumRecords` is `PARTIAL`, never `COMPLETED`.** | The count is the evidence and the status is the reading of it; `RECORD_SHORTFALL` names both numbers in the message so nobody has to diff a log to learn how much was missing |
| 2026-09-29 | **The planner is deterministic code, not a language model, and it emits only steps this build executes.** | Phase 3's structured call already produced the requirement, schema and queries; deriving the DAG from them keeps the same-input → same-`planHash` property and keeps a model out of the space between the contract and the queue. `SAVE` and `EXPORT` are *absent* rather than present-and-skipped, inverting the old `EXPORT_NOT_IN_PHASE` placeholder that let a plan look complete while doing nothing (`workflow-runner.ts:167-169`) |
| 2026-09-29 | **A job carries its own config snapshot** — `PlanSteps.payloadFor` copies the step's config into `workflow_jobs.payload` at enqueue time. | A job reclaimed an hour later must execute the plan that was current when it was created, not whatever the mutable plan row says now |
| 2026-09-29 | **Steps are materialised up front; jobs are created only when their dependencies are satisfied.** | Then every `PENDING` job in the queue is genuinely executable, so no worker has to claim work, discover its predecessors are unfinished and put it back. Materialising the steps is also what lets `GET /runs/{id}` show the whole plan, including the parts still waiting |
| 2026-09-29, **extended 2026-09-30** | **The `VALIDATE` step is Java re-enforcing Python's claim, and it deletes nothing.** | `WorkflowService.plan` refuses to store a plan from an unverified AI answer, and `ValidateStepHandler` refuses to call a record valid because the graph said so: required fields present and non-blank, a source with `verifiedByTool`, and a dedupe identity. Failures are counted and reported by index (max 50, plus `issuesTruncated`), because the old `persistDataset` dropped unevidenced rows in silence (`00-FORENSIC-AUDIT.md` §5 item 8). **Phase 8 changed what it reads:** it no longer examines the raw collection output but the pipeline's records out of the `TRANSFORM` step's summary, and the checks moved from ad-hoc loop logic into `RowContractEnforcer` with the plan's typed field list, so type conformance, duplicate-link integrity and conflict preservation are checked as well as presence and evidence |
| 2026-09-29 | **The activity log is written before anything is broadcast, always,** and a failed monitoring write is logged with the run id rather than swallowed. | It is what makes post-restart history and SSE replay correct without Redis pub/sub: the table is the truth and a stream is a convenience |
| 2026-09-29 | **Tenancy stays in configuration while authentication does not exist, and a foreign id answers as not-found.** | `FINALAGENT_WORKSPACE_ID` is never read from a request; `require(runId)` returns the same 404 for another workspace's run as for a nonexistent one, because confirming that an id exists is itself a leak. `Principals.UNAUTHENTICATED` (nil UUID) is the actor: "we do not know who", not a placeholder that resembles an account |
| 2026-09-29 | **Flyway is tied to `WORKFLOW_EXECUTION_ENABLED`, with `baseline-on-migrate: false`.** | One switch for the layer and the schema it needs, so nothing can start the queue against an unmigrated database; and baselining away a pre-existing schema would skip precisely the unique keys and compound FKs the guarantees live in |
| 2026-09-29 | **`AiServiceClient` gets a second `RestClient` for research calls.** | The 3 s JSON parse timeout is right for requirement analysis and wrong for a multi-minute collection. The research client reads `min(300 s, stepTimeout + 5 s)` so the caller gives up slightly *after* the step's own budget, and the step timeout — not a socket default — remains what actually bounds a job |
| 2026-09-29 | **The MySQL integration tests are gated by `FINALAGENT_TEST_MYSQL=true`, and `verify.sh` reports them as SKIPPED when it is off.** | A queue's locking guarantees cannot be shown against doubles — mocking `claim()` would be a test of Mockito. The gate means an environment without a database says "not run" out loud instead of implying it ran |
| 2026-09-30 | **The quality pipeline runs once per run, behind one `TRANSFORM` step — not once per stage-bearing step.** | The legacy runner executed the whole chain at both its MERGE and its SAVE steps (`workflow-runner.ts:160,164`), so a plan with both normalized, validated and deduplicated the same records twice. Splitting the six stages across six workflow steps would have reintroduced that in a new shape and serialized the record set through a JSON column six times before there is a dataset table to hold it. What the caller needs — seeing what each stage did — is provided by the per-stage `StageReport` inside one response |
| 2026-09-30 | **Java enforces the plan's field list, never the dataset columns the pipeline emitted.** | `A` §A.2 only means something if the second opinion is independent. A checker that reads its spec from the thing it is checking can only confirm what the other side decided, and a column the pipeline invented (an undeclared `source_page`, typed `STRING` by default) would silently become the rule. `DeclaredContract` carries a `basis` — `plan` or the weaker `pipeline-columns` — and the fallback announces itself in the step summary |
| 2026-09-30 | **`RowContractEnforcer` reports disagreement in both directions instead of overwriting either verdict.** | `ADVISORY_PASSED_HERE_REJECTED` is the fabricated pass this gate exists to catch; `ADVISORY_REJECTED_HERE_PASSED` is evidence that Java is stricter than it needs to be. Both are findings, neither is resolved by whichever implementation ran last, and the run's counters take Java's number while the pipeline's stay visible as `advisory*` |
| 2026-09-30 | **Duplicates are linked, invalid records are flagged, and neither is ever deleted — by Java and Python alike.** | The old `persistDataset` skipped rows whose sources did not hash-match a persisted `Source` (`workflow-execution.repository.ts:271-272`), so a dataset could land short with no explanation. Here `rowsChecked + linkedDuplicates == records.size()` is an assertion, and a record that is neither a row nor a link is a *structural* failure |
| 2026-09-30 | **Entity resolution keeps "a shared stable identifier is required to merge"; name similarity alone yields `REVIEW_REQUIRED`.** | The conservative half of `EntityResolutionService.ts:20,24` from the old project, kept deliberately: a false merge is invisible afterwards and a false split is not. Threshold 0.94 inherited because it is the stricter number, not because it was measured here |
| 2026-09-30 | **Levenshtein is implemented in-house; `rapidfuzz`/`commons-text` were not added.** | Audit `C` suggested a library. One bounded string distance does not justify a compiled dependency in a service whose base install is FastAPI/uvicorn/Pydantic/dotenv, and this project has twice preferred no new dependency over a convenience |
| 2026-09-30 | **`POST /ai/v1/quality/process` is a synchronous `def`, and the pipeline holds no state.** | An `async def` handler would run CPU-bound text processing on the event loop and stall every other request; a sync handler is dispatched to FastAPI's threadpool. Being pure means nothing is lost on restart, which is what keeps the no-Redis constraint safe |
| 2026-09-30 | **The wire contract between the two languages is pinned on both sides by one generated fixture.** | `backend/src/test/resources/wire/quality-process.json` is written by the pipeline itself; `test_quality_wire_fixture.py` fails if Python's output drifts from it and `QualityWireContractTest` fails if Java's DTOs stop binding it. A hand-written snapshot on either side would age silently — Spring drops unknown properties, so drift never shows up as a parse error, only as a dataset of nulls three steps later |
| 2026-09-30 | **Phase 6 is two patterns inside the existing graph, not a browser agent.** `TheAgenticBrowser-main`'s planner/browser/critique trio is refused; its distrust of the executor's own success claim is taken. | Three cooperating agents around a local Playwright instance is the second orchestrator `A` §A.1 exists to prevent, and this service has no browser to drive — Firecrawl's `interact` takes a natural-language action against a session that is already budgeted, policy-checked, evidence-gated and stopped in a `finally`. What was genuinely missing was verification of the action's effect and evidence in front of the reviewer, and both fit in the graph that already runs |
| 2026-09-30 | **An interaction's effect is reported as `CHANGED` / `UNCHANGED` / `UNKNOWN`, never as success — and an unverifiable one forces `COMPLETED_WITH_WARNINGS`.** | A session replying is not a page moving. Upstream had a screenshot judge precisely because the executor's own claim cannot be trusted (`ss_analysis.py:69`), and we have only text, so the strong claim is unavailable and the weak one is named. A differing page proves nothing about the filter having applied; an identical page proves something. The LLM critique cannot be what closes that doubt, so the status rule does |
| 2026-09-30 | **The reviewer receives bounded excerpts of what was read, plus which contract field names appear in them; the submission transcript keeps every page whole.** | `critique.md` demanded "adequately evidenced" while the prompt gave the judge a list of URLs — an instruction with nothing to check against, so a fabricated value was invisible. Porting upstream's DOM pruning *wholesale* would have made it worse: `orchestrator.py:99-132` blanks the content the critique is supposed to judge. Bounding for review, never blanking, and never pruning the extractor's own input |
| 2026-09-30 | **Credential entry, CSP bypass and automation-flag evasion are refused outright, and the refusal is asserted in a test.** | TheAgenticBrowser documents filling `#username`/`#password` (`browser_agent.py:36,140-144`) and launches with `bypass_csp=True` + `--disable-blink-features=AutomationControlled` (`browser_manager.py:219-221`). Our safety literals are constants in `WorkflowPlanner.safetyPolicy`, the brief forbids bypassing access controls, and the corrective advice a failed action produces is now tested to offer another *source* and to contain no login/password/captcha/bypass/paywall wording |
| 2026-09-30 | **No Java, schema or DTO change for Phase 6.** New signals travel as `metadata.turnsByNode`, `metadata.interactions`, `metadata.interactionsUnverified` and one more `validation.warnings` entry. | `ResearchResult.metadata` is a free-form map that `ExtractStepHandler` already copies into the step summary, so adding to it needed no seam change. A phase that cannot be expressed without touching the authoritative layer would be a sign the change belonged there — this one is a statement about how much a Python-side run can believe about itself |
| 2026-09-30 | **`SAVE` joined the plan because there is now something it writes; `EXPORT` still has not, and still will not be emitted as a placeholder.** | The old runner shipped `EXPORT_NOT_IN_PHASE` steps for work it never did (`workflow-runner.ts:167-169`), which is how a plan looked complete while doing nothing. Four steps now exist because a dataset, a repository and a transaction exist behind the fourth |
| 2026-09-30 | **The dataset's columns are rows, and their `origin` is recorded.** | A schema that only the pipeline saw is the defect this rebuild was started for. `PLAN` / `EXTRACTION_SCHEMA` / `PIPELINE` / `DATA` on each column separates "someone asked for this field" from "a page happened to contain it", which is what lets a reviewer question a column instead of inheriting it |
| 2026-09-30 | **Values stay JSON and filters reach them through a bound path, with the dataset's own column list as the gate — no per-dataset DDL.** | A functional index cannot exist on a column nobody declared until the run finished, and creating generated columns per dataset would mean schema DDL on behalf of a prompt. So filter and sort are `JSON_EXTRACT(values_json, ?)` with the key resolved against `dataset_columns` first: safe, dynamic, and a scan. The scan is the recorded cost, not an oversight |
| 2026-09-30 | **A dataset's counts are derived from the rows written in the same transaction, and citation counts are recomputed by MySQL from the join.** | Two derivations, deliberately not copied from the run's own report: header totals come from the lists being inserted, and `cited_by_rows`/`citation_count` come back from the database. A dataset whose header disagreed with its own rows would be a second, quieter source of truth — which is what §1 of the forensic audit is about |
| 2026-09-30 | **Field-level evidence is written only when the field's own value is the URL of a page a tool returned.** | A row citing three pages does not make three sources the provenance of every field in it. Phase 10's first full test run found this layer writing exactly that attribution for an invented URL (P36) — which is why the rule is stated in the schema comment, the service javadoc and a test rather than left to the reader's goodwill |
| 2026-09-30 | **Rows Java never judged are saved invalid, and an unjudged row is never defaulted to valid.** | `DatasetAssembler.assemble` receives `record index → Java verdict`; absent means the authoritative gate did not speak, and treating silence as a pass would make this layer the one that fails open |
| 2026-09-30 | **V3 is the dataset platform; identity is pushed to V4.** | The audit reserved `V3__baseline_identity` for authentication, which is still unbuilt. Rather than create empty tables to fill a slot — the reason V1 is workflows and not identity — the reservation gives way to code that exists. No applied migration was renumbered or edited: Flyway verifies checksums of what it has run |

| 2026-09-30 | **Sessions are opaque values hashed in MySQL, not JWTs.** | The brief's constraint was that the frontend never receive a signing secret. A build with no signing secret satisfies it by construction, and logout becomes a row delete instead of a request that a stateless claim honour. The cost is one indexed lookup per request, which every endpoint already pays to read the data the request is about. Recorded as a deviation because the vocabulary of the brief assumed otherwise. |
| 2026-09-30 | **`FINALAGENT_WORKSPACE_ID` deleted rather than defaulted.** | A configured tenant makes every caller the same person; a configured tenant kept "just in case" is the same mistake with a compatibility note attached. A tenant-scoped service reached without a session now raises rather than falling back, which is the only shape in which the fallback cannot come back. |
| 2026-09-30 | **State changes require `X-Requested-With`; Spring's CSRF token is not used.** | Found over HTTP, not MockMvc: with `HttpOnly` cookie auth and Spring 6's lazily-issued token, a browser that had not asked for a token could not send one, so every honest frontend `POST` would fail closed while a hand-written request passed. The header cannot be set cross-origin without a preflight, and the preflight is answered only for exact origins. Deviation documented in `SecurityConfig` with its residual gap. |
| 2026-09-30 | **A legacy actor becomes a `SERVICE` user with a NULL hash, never a seeded login.** | Pre-authentication rows already name `00000000-…-000000000000`; the FK the audit asked for needs that value to resolve. Making it a real row with no password is honest ("this was not a person"), while giving it a password — or a bypass branch — is how `demo@pirateagent.ai` happened. |

## 4. Database / Schema Changes

**Phase 7 created the first real schema.** Two Flyway migrations now exist and have been applied
to and re-applied against native **MySQL 9.6.0** (`finalagent_dev`), not merely written:

| Migration | Tables | What it guarantees |
|---|---|---|
| `V1__workflow_definition.sql` | `workflows`, `workflow_plans` | `UNIQUE (workspace_id, id)` so a compound FK can be tenant-scoped; `UNIQUE (workflow_id, version)` because plans are immutable and a run must keep pointing at the version it executed |
| `V2__execution.sql` | `workflow_runs`, `workflow_steps`, `workflow_jobs`, `activity_events` | `UNIQUE (workflow_id, attempt)` — duplicate *start* refused; `UNIQUE (run_id, step_key)` and `UNIQUE (run_id, sequence)` — duplicate *step* refused; **`UNIQUE (run_id, step_id)`** — duplicate *job* refused; `idx_jobs_claim (status, scheduled_for, priority, created_at)` — the claim query's covering index; `idx_jobs_lease (status, lease_expires_at)` — the sweeper's; both `runs` and `steps` FK to `(run_id, workspace_id)` so a job can never point at a run in another workspace |

Numbering deviates from `E-database-model.md`: the audit's `V1__baseline_identity` belongs to the
authentication phase, which has not been built. Rather than create empty tables to fill a slot,
V1 is the first aggregate with working code behind it. **An already-applied migration is never
renumbered or edited** — Flyway verifies checksums of what it has run — so when identity lands it
arrives as `V3__baseline_identity.sql`, and the `workspace_id` / `created_by_id` columns that are
`NOT NULL` today with **no foreign key** get theirs then. That is a real gap, recorded here and in
`E`, not a design choice.

**Phase 8 added no schema.** The step-type ENUM in `V2__execution.sql` already declared `TRANSFORM`,
`VALIDATE`, `DEDUPLICATE`, `MERGE`, `VERIFY` and `SAVE` before any of them had code, so the pipeline's
`TRANSFORM` step landed in a column that was waiting for it. What changed was the run's counters:
`TRANSFORM` owns `duplicates` and contributes nothing to `records_found` / `records_raw`, which
`EXTRACT` already added (P23). Two ai-service settings arrived instead of columns, both range-checked
at boot so a bad value stops the process rather than changing what a dataset means:
`ENTITY_MATCH_THRESHOLD` (default 0.94, bounded 0.5-1.0) and `QUALITY_MAX_BLOCK_SIZE` (default 400,
bounded 2-100000).

**Phase 9 added the schema, and it is V3.** Seven tables, applied by Flyway against MySQL 9.6.0 and
verified by 17 tests that run against that server, not against doubles:

| Table | What it holds | What its keys guarantee |
|---|---|---|
| `datasets` | one saved dataset per run: objective, verbatim requirement text, entity type, the extraction schema it was produced under, status, counts, quality score + basis | `UNIQUE (run_id)` — a retried save replaces its own dataset instead of minting a second one; `uq_dataset_scope (id, workspace_id)` so children can reference the pair |
| `dataset_columns` | the dynamic schema: folded key, label, declared type, required, position, `origin`, measured populated count | `UNIQUE (dataset_id, field_key)` — one declaration per field, whatever the run said |
| `dataset_rows` | one row per record: `values_json`, `raw_values_json`, `search_text`, Java's `valid` **beside** the pipeline's `advisory_valid`, verification status, nullable confidence, `duplicate_of_row_id`, `match_type`, issues, notes, per-row source and evidence counts | `UNIQUE (dataset_id, record_index)`; `duplicate_of_row_id` is a self-link with `ON DELETE SET NULL`, and a row that is a link is still a row — `idx_rows_dataset_list` serves the canonical-only listing |
| `dataset_sources` | every page touched: URL, `url_hash`, domain, title, snippet, how it was reached, when it was retrieved, `verified_by_tool`, `provenance`, refusal code and reason, citation counts | `UNIQUE (dataset_id, url_hash)` — a URL cannot be a key at 1000 characters, and a `?utm_` variant must not become a second source for one page |
| `dataset_row_sources` | the row ↔ page join, in both directions | `UNIQUE (row_id, source_id)` |
| `dataset_field_evidence` | field-level attribution, `FIELD_URL` or `DECLARED_SOURCE`, and nothing else | `UNIQUE (row_id, column_key, source_id, kind)` |
| `dataset_conflicts` | both values, both source lists, and the rule that chose between them | keyed by row and column; nothing is dropped from a disagreement |

Phase 10 added no further tables: it wrote the traceability *through* these — `run_id` and `step_id` on
every row and source, so a value names the run, the step and the page that produced it.

**Phase 11 added `V4__exports_and_monitoring.sql`,** applied by Flyway against the same MySQL 9.6.0 and
verified by the 11 tests of `ExportProgressMySqlTest`, run against that server:

| Object | What it holds | What its keys and columns guarantee |
|---|---|---|
| `export_jobs` | one requested file: dataset, format, the requester's scope as JSON, `total_rows` / `written_rows` / `progress_percent`, the published name, path, byte count and SHA-256, error code and reason, and a timestamp for each transition | `uq_export_scope (workspace_id, id)` so a child can reference the pair; `fk_export_dataset` on `(dataset_id, workspace_id)` `ON DELETE CASCADE`, so a dataset's export records cannot outlive it as references to files nobody can attribute; `status` an ENUM whose `RUNNING` is set only by the worker that claimed the job |
| `idx_events_workspace_recent` | `(workspace_id, id DESC)` on `activity_events` | the workspace feed and its cursor. `idx_events_run` served one run at a time; a workspace-wide listing sorted the whole table |
| `idx_runs_workflow_recent` | `(workspace_id, workflow_id, created_at DESC)` on `workflow_runs` | run history per workflow, ordered by the column that actually means recency — P46 caught this index written against `id` before it was ever applied, and run ids are random UUIDs |

Progress has nowhere to be invented. `progress_percent` is derived by `ExportRepository.advance` from
`written_rows` against `total_rows`, capped at 99 until the record completes, and that is the only
statement in the codebase that writes the column — the schema offers no slot for a figure a caller
claimed.

**Phase 12 added `V5__baseline_identity.sql`,** the four identity tables and the constraints the audit
asked for by name. Applied by Flyway against the same MySQL 9.6.0, and the schema is now **19 tables
with 35 referential constraints**, all five migrations `success = 1`:

| Object | What it holds | What its keys guarantee |
|---|---|---|
| `users` | address, display name, bcrypt hash, status, failed-attempt count, lockout deadline, last login | `uq_user_email` is the *only* thing making `Alex@` and `alex@` one account, and `password_hash NULL` is the only representation of "cannot authenticate" — the service actor and any future machine row live on that column rather than on a branch in the login code |
| `workspaces` | the tenant, `PERSONAL` or `TEAM` | one row per tenant, so every `workspace_id` elsewhere can be a foreign key rather than a convention |
| `workspace_members` | the (workspace, person) pair and its role | composite PK means one standing per person per tenant; both FKs cascade, because membership is an attribute of a tenant and not work a tenant did |
| `auth_sessions` | the SHA-256 of what was presented, its family, and three deadlines | `uq_session_token` makes a presented token one row; `family_id` is what rotation-reuse detection ends; `expires_at` moves on renewal and `absolute_expires_at` never does, so a copied token buys a longer life rather than an unlimited one |
| FKs added to existing tables | `workflows`, `workflow_plans`, `workflow_runs`, `workflow_steps`, `workflow_jobs`, `activity_events`, `datasets`, `export_jobs` | every `workspace_id` now names a real tenant and every author names a real row. `RESTRICT`, not `CASCADE`: deleting a workspace that still holds runs is not a cascade anyone asked for |

The legacy tenants and actors were **materialised from the data that already existed** — distinct
`workspace_id` values across the workflow, dataset and export tables became workspace rows, and the
`created_by_id` values they carried became `SERVICE` users — rather than by inventing ids in DDL.
`FINALAGENT_WORKSPACE_ID` was an environment value, so no migration could have known to create it, and
a hardcoded UUID in V5 would have been a placeholder wearing a constraint. The address of every such row
ends `@invalid.invalid`, a reserved TLD no one can register later.

**Rebuilding the schema rather than patching it.** V5 was applied by hand once while a `UNION` arity
error in its backfill was being found, which left the constraints in place and Flyway with a
`success = 0` row for version 5. Re-running it collided on duplicate constraint names, so the dev
schema was dropped entirely and re-created from V1 → V5 by Flyway, the same way the half-applied V3 was
handled in Phase 9. The alternative — deleting the history row and keeping the hand-applied schema —
would have left the running database in a state no migration produces, which is the thing this schema
is written to make impossible. The 12 rows it discarded were test fixtures; the suites rebuild
everything they read.

Tenant scoping turned out to be structural rather than polite. Every child carries `workspace_id` and
foreign-keys to `(dataset_id, workspace_id)`, so MySQL **refuses** to move a dataset header out from
under its own rows; P38 found that by trying, and the assertion stayed. Phase 11 inherited the same
consequence for exports: `export_jobs` keys its FK on that pair, so a requested file cannot be re-homed
either.

**The numbering decision the audit will want checked.** `E-database-model.md` reserved `V3` and `V4` for
`baseline_identity`, and identity is still unbuilt. Rather than create empty tables to fill a slot — the
same reasoning that made V1 workflows rather than identity — both slots gave way to code that exists:
the dataset platform took V3 in Phase 9, and exports and monitoring took V4 here. No applied migration
was renumbered or edited, because Flyway verifies checksums of what it has run;
`flyway_schema_history` now holds 1, 2, 3, 4, all `success = 1`, and the schema has 15 tables.
**Authentication arrives as `V5__baseline_identity.sql`**, and that is the last slot the audit's numbering
still owns.

`workflow_steps.output_summary_json` is still written and still read: the save step reads the
pipeline's records out of the transform step's summary and Java's verdicts out of the validating
step's. Phase 9 replaced the **destination**, not the handoff — the dataset tables are where an answer
lives now, and the step summaries are how the next step re-reads the one before it.

Changes made to the DDL *because MySQL disagreed with it* (both P12/P13 in §2):

- `fk_runs_plan` gained `ON DELETE CASCADE`. Without it a workflow that had ever run could not be
  deleted at all: deleting the parent cascades to `workflow_plans` and to `workflow_runs`, and the
  run's reference to its plan blocked the plan's removal.
- `workflow_jobs.last_error_message` stays `VARCHAR(2000)` and the repository truncates to fit, so
  a long provider payload cannot abort the write that records why a job failed.
- `fk_dataset_workflow` had to name its columns in the order the referenced key does
  (`workflows (workspace_id, id)`), while `fk_dataset_run` names `workflow_runs (id, workspace_id)`
  — the two parents are keyed in opposite orders, and MySQL error 6125 said so. P31.

`V2` was edited once (the cascade) *before* the phase shipped, which was only permissible because
the schema had never been applied anywhere but this local dev database; the tables were dropped and
both migrations re-applied, and `flyway_schema_history` now holds exactly 2 rows. Against a shared
or deployed database the same fix would have had to be a new `V3`.

Still deliberately absent: `source_domain_policy`, `users`, `workspaces`, `refresh_tokens` — all four
are identity's, and they arrive together as V5. What is no longer absent is the dataset model itself,
which this section listed as a gap until Phase 9, and `export_jobs`, which it listed as a gap until
Phase 11.

What the schema is *not*: it is not JPA-generated. `pom.xml` carries `flyway-core` + `flyway-mysql`
and no JPA provider for these tables; the queue needs conditional `UPDATE … WHERE status = ? AND
version = ?` and `NOW(6)`-based lease arithmetic that an ORM would only obscure, so the SQL is
written where it is used and the records in `workflow/domain/Records.java` are an anaemic read
model over JDBC row mappers. `dataset/domain/DatasetRows.java` follows the same rule.

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

### Verification limits introduced by Phase 7 (what the MySQL tests do *not* prove)

The queue is now tested against a real database, which is a different class of evidence from
everything before it. Three things it still does not show:

- **Single process, many threads — not many processes.** `eightThreadsRacingForOneJobProduceExactlyOneOwner`
  contends across 8 threads in one JVM against one MySQL. The claim statement itself does not care
  which process sent it, and that is the whole point of putting the lock in the database, but a
  genuine two-host test would additionally exercise `WorkerIdentity` uniqueness across machines,
  different clock domains, and a SIGKILL that never runs the shutdown lease release. None of that
  has been run, because there is one machine here.
- **`Flyway 11.7.2 officially supports MySQL 8.1; this ran on 9.6.** Every migration applied and
  validated, and the startup logged `Flyway upgrade recommended: MySQL 9.6 is newer than this
  version of Flyway and support has not been tested`. Recorded as R40 rather than treated as a pass.
- **Collection still has never touched the web.** `AiServiceClient` is mocked in the lifecycle
  tests, so what is proven is API → run → job → claim → handler → result → status, with the
  AI-service boundary asserted at the request that leaves Spring. `FIRECRAWL_API_KEY` is still
  blank (length 0 in the shell and in `.env`), so the real cost, real duration and real failure
  modes of a step that actually collects remain unmeasured — including whether the 240 s step
  budget and 300 s lease are sized for real research runs at all.

One live boot was done for real: `java -jar backend/target/backend-0.1.0.jar` with
`WORKFLOW_EXECUTION_ENABLED=true` reached `Started BackendApplication in 4.324 seconds`, Flyway
connected to MySQL 9.6, the worker logged its lease and pool, `GET /api/v1/workflows/runs` answered
200 with worker stats, and `/api/v1/ready` answered **503** with `workflowQueue UP` but
`aiService DOWN (reachable:false)` — correct, because the Python service was not running. The
last Phase 1 exit criterion (B1, an account the application can connect as) is closed.

### Verification limits introduced by Phase 8 (what the pipeline tests do *not* prove)

104 new ai-service cases and 62 new backend cases say the pipeline behaves as designed on records this
project wrote. Four things remain genuinely unproven:

- **No real scraped record has ever passed through it.** `FIRECRAWL_API_KEY` is still blank, so every
  input is test-constructed or produced by the mocked collection step. Normalization is exercised
  against values chosen to be awkward; how often an actual Firecrawl scrape yields `"4.5M"` versus
  `4500000` for a funding amount, and what other shapes real pages bring, is unmeasured.
- **The thresholds are reasoned, not tuned.** 0.94 came from the old service because it is the
  conservative number, and 400 records per block is a bound that prevents a quadratic scan, not one
  derived from a real dataset. Neither has been run against data large or messy enough to say whether
  they are right — `test_a_pathological_block_is_reported_for_both_comparisons_it_prevented` proves
  the *reporting* works, not that the bound is the correct size.
- **Scale of the synchronous pass is unknown.** The pipeline is CPU-bound Python on FastAPI's
  threadpool, and the client's socket patience is `min(300 s, stepTimeout + 5 s)`. At 500 records the
  pass has never been timed, so the pairing of those two budgets against real duration is Phase 7's
  open question (§5, third bullet) restated for a second call.
- **The two verdicts have only disagreed in one direction on real captured data.** On the wire fixture
  Java rejects four canonical rows and the pipeline agrees on three, disagreeing on exactly the record
  whose only citation was never tool-retrieved. `ADVISORY_REJECTED_HERE_PASSED` — Java being stricter
  than it needs to be — is covered by a synthetic case only. If it turns up on live runs at a high
  rate, that is evidence this gate is over-typed and should be read as a defect in Java's rules, not
  in the data.

Also unchanged: the pipeline is reachable through `POST /ai/v1/quality/process` behind the shared
`X-API-Key`, and the workflow endpoints that call it are still unauthenticated, so a caller who can
start a run can now also make Spring spend Python CPU on it.

### Verification limits introduced by Phases 9 and 10

The dataset tables are proven against a real database and against fixtures this project wrote. Four
things they do not show:

- **Scale.** Every test saves 1-3 rows. A dataset with 10,000 rows read through
  `JSON_EXTRACT(values_json, ?)` with `LIKE`-ed search is a scan, and the point at which that stops
  being acceptable has not been measured — there is no functional index, and no per-dataset generated
  columns either. The upgrade is named in the DDL comment, not benchmarked.
- **Nothing has ever been collected.** `FIRECRAWL_API_KEY` is still blank, so every saved row's values
  and every `dataset_sources` row were authored by a test. The `verified_by_tool` flag is proven to be
  respected, and proven never to be granted on the strength of a citation (P36) — but it has never
  been set by a real page being fetched.
- **Retrieval time is only as good as the pipeline's stamp.** `asTimestamp` returns null for anything
  it cannot parse, which is right, and means an unparseable stamp silently loses its ordering value
  in a facet or a "most recently retrieved" sort. No live run has produced one yet.
- **`search_text` is a concatenation, so a hit is not a match meaning.** A substring crossing a
  field boundary can match ("…engineer bengaluru…" matching `engineer ben`), and the API reports which
  fields contained the term by re-checking each value, which is the part a caller should read. The
  fulltext index that would make this word-precise was deliberately not created, because fragment
  queries are what people type.

### Verification limits introduced by Phase 6

The interaction verification is tested against scripted sessions, which is the only kind of session
this machine can produce. What that does **not** establish:

- **Whether `CHANGED` is worth anything on real pages.** Live pages differ after an action for reasons
  unrelated to it — timestamps, ads, pagination chrome, A/B shells — so `CHANGED` is likely to be
  near-universal and therefore weak, while `UNCHANGED` is the only verdict that reliably means
  something. The design assumes that asymmetry; it has not measured it.
- **Whether text comparison is the right comparison.** Firecrawl returns markdown, not a DOM, so an
  action that changes a control's state without changing visible text (a sort that reorders rows
  already in the same order, a toggle that only styles) reads as `UNCHANGED` and would be reported as
  an unverified action. Whether that happens often enough to matter is a live-data question.
- **The `UNKNOWN` rate**, which depends on how often runs act on searched-but-never-read URLs; the
  evidence rule admits them, so it is not pathological, just unquantified.
- **The status rule's cost.** Any unverifiable session now makes a run `PARTIAL`-adjacent
  (`COMPLETED_WITH_WARNINGS`), so if live runs produce these routinely, a caller watching status will
  see warnings that are about the browser rather than the data. The knob if that proves noisy is
  comparing on the checklist fields rather than the whole page — to be turned against observed
  sessions, not ahead of them.
- Nothing here exercises the **retry/correct** path beyond the transcript advice the planner is given.
  Whether models actually change course on `[verification: …]` rather than resubmitting is a live
  provider behaviour, untested with a real key.

### Verification limits introduced by Phase 11

The export and operations tests run against real MySQL but against fixtures, so what they establish is
the machinery, not its behaviour at the sizes that matter. What they do **not** establish:

- **How a large export behaves.** The ceiling test refuses at `max-rows + 1`, but every dataset here is
  a handful of rows. How long a 200 000-row XLSX takes, whether the heartbeat keeps its lease through
  one, and what it does to the pool's capacity for steps are unmeasured — a long export occupies a
  worker by design, and no test here has made one long enough to watch that happen.
- **That SXSSF's memory claim holds.** The writer streams and the byte count comes from the counting
  stream, both asserted; the *reason* it streams — constant memory on a big file — has never been
  observed, because nothing here has produced a big file.
- **What the monitoring figures look like when they are wrong.** Every number is a `COUNT(*)` or a
  `SUM` over real tables, verified equal to the tables in one test. What is not tested is the operator's
  question — "is it slower than usual" — because there is no time series, only point-in-time reads.
- **Export-file retention does not exist.** Nothing sweeps `var/exports`, so disk growth is an operator
  concern until it is implemented, and the `ON DELETE CASCADE` comment in V4 anticipates a rule rather
  than describing one.
- **The activity feed is polled, never pushed.** `nextCursor` and the `action` prefix filter are
  asserted by paging to empty; the SSE layer that would sit on the same log is unbuilt, so "events
  arrive promptly" is still not a claim this project can make.
- **Everything is still single-tenant by configuration.** An export is now an endpoint that hands back a
  file of another workspace's rows the moment tenancy is real, which makes the Phase 12 work on
  `/api/v1/*` more urgent than it was when the only unauthenticated route started work.

### Verification limits introduced by Phase 12

Authentication is real and enforced now, but it is real at the boundary of the API rather than at the
boundary a user stands at. What this phase does **not** establish:

- **Nothing in the browser uses any of it yet.** The frontend has no login screen and its eight
  dashboard routes still render placeholders, so the whole surface 401s at a browser today. The
  credential round trip is proven by `curl` against a running service and by
  `AuthenticationMySqlTest`; it is not proven against the Next.js rewrite, the `SameSite` interaction
  with `localhost:3000`, or a real cookie jar. Phase 13 is where that becomes an observation rather
  than an expectation.
- **`SameSite=Strict` and the preflight are reasoned about, not attacked.** The state-change header
  replaced Spring's own token because the token was unreachable for a browser (P51). The reasoning and
  its residual are written in `SecurityConfig`: if a future client ever sends that header on a request a
  foreign page can cause, two of the three controls would have to fail together instead of three. No
  cross-site request has been made against a running instance.
- **Rate limiting on the credential endpoints does not exist.** There is no Redis and no counter table
  for per-IP throttling; the lockout is per account, so a password list aimed at many accounts is
  unthrottled. Recorded, not solved.
- **Roles are enforced but not managed.** `OWNER`/`EDITOR`/`VIEWER` are honoured on every request, and
  the only ways to acquire one are registration or a direct row insert. The demotion path that the
  re-read-membership-per-request design exists to support has no door yet.
- **A person with several workspaces is signed into one of them.** `primaryMembership` picks the oldest
  personal workspace and switching is unbuilt — which is precisely why no request path accepts a
  workspace id from anywhere. The mechanism for choosing deliberately should be written when the need is
  real rather than guessed at now.
- **Session rows and export files both accumulate.** `auth_sessions` is revoked but never deleted, and
  `var/exports` is never swept. One retention job covers both eventually; neither exists.
- **The hazard P53 exposed is a standing condition of the suite.** A second process pointed at
  `finalagent_dev` claims work from the shared queue and its effects land inside another test's
  assertions. Nothing detects that today — the profile's 30-second lease and the note in §7 are the
  mitigation, and a dedicated schema per run would be the fix.

### Findings from Phase 15 (repository extraction) — recorded, deliberately **not** fixed

Phase 15 was an inspection phase with an instruction not to delete the reference folders, and the
standing rule is that an audit is reported rather than auto-fixed. Every row below was verified against
the current tree by grep or by running the code, not by reading a plan; each names the evidence and the
exact gap. **Phase 17 closed three of them** — P57 (the dead plan contract and its sibling models are
deleted), P64 (the gate now matches `*MySqlTest`, 75 tests) and P70 (`@radix-ui/react-label` is gone) —
and left the other fifteen untouched; §2 Phase 17.1–17.2 records what went, what stayed and why.
**P54 is the only one that is a live vulnerability rather than an unbuilt feature**, and it
is the one worth authorizing first.

| # | Finding | Evidence | What it means |
|---|---|---|---|
| P54 | **No host-resolution SSRF guard exists in any runtime, and this service makes the unguarded outbound call itself.** `curation/robots.py::_fetch` builds `{scheme}://{netloc}/robots.txt` and `urlopen`s it (`:145`, `:159-162`) for any origin appearing in the pipeline; `firecrawl/client.py::validated_http_url` checks scheme and a non-empty netloc only (`:143-161`), and its own comment says host resolution "belongs to Spring" — where there is none. | `grep -rn "169\.254\|100\.64\|isLoopback\|isSiteLocal\|is_private\|InetAddress"` over `ai-service/app`, `backend/src/main`, `frontend/{app,lib,components,hooks}` → **zero hits** | A page that plants a link to `http://169.254.169.254/…`, `http://127.0.0.1:…` or an RFC1918 host earns a real TCP connection from the ai-service, and a 200 answer is parsed as robots text — no `Disallow` lines, therefore *allowed*. Firecrawl's own scrape goes to Firecrawl's network, so the exposure that is ours is this fetch and any future direct call. §8 has carried "host-resolution SSRF — not built" since Phase 5; it is not merely absent, it is reachable |
| P55 | **The per-domain request rate is produced, validated and consumed by nothing.** `contracts.py:198` declares `max_requests_per_domain_per_minute` (`:207-211` bounds it 1–60), `curation/queries.py:60` sets it to 20, and no code reads the value before issuing a request. The only ceilings that bite are `ranking.py:120-128` (candidates per domain) and the process-wide semaphore at `firecrawl/client.py:350`. | grep for the field name across both runtimes returns declaration, validation and the producer only | A plan can state a politeness limit the system then ignores. No Bucket4j, no crawl-delay floor, no MySQL-backed window. `00-FORENSIC-AUDIT.md` §5 named a dead configured rate as an old-project defect; this is the same shape in new code |
| P56 | **No inbound HTTP rate limiting.** No limiter on any route, including `/api/v1/auth/login`; `Retry-After` appears only as a CORS *exposed* header (`WebConfig.java:41`). | grep `RateLimiter\|Bucket4j\|slowapi\|429` over `backend/src/main`, `ai-service/app` | The Phase 12 lockout is per account and per database clock, so a credential list spread across many accounts is unthrottled at the edge. Already recorded honestly in the Phase 12 limits above; numbered here so it is one list with the rest |
| P57 | **`WorkflowPlan` in Python is dead code.** `contracts.py:215-253` defines the plan contract — 2–30 steps, `timeoutMs` 1 s–300 s, `maxAttempts` ≤ 5, dependencies referencing earlier steps, ≥ 1 EXTRACT and ≥ 1 SAVE, `additionalProperties: false` — and the only references to the symbol are its own class line and its own `@model_validator`. | `grep -rn "WorkflowPlan" --include=*.py --include=*.java` over both trees → `contracts.py:215`, `contracts.py:236`, and a stale `ai-service/build/lib/` copy | **Not a hole, but a misleading artefact.** Java authors a fixed four-step plan itself (`WorkflowPlanner.java:113-117`), so there is no model-produced plan to validate and every bound in the class is unexecuted. The safety floor *is* real and is stronger than a validator: the four literals are Java constants (`WorkflowPlanner.java:157-160`) that no model supplies. Either wire `WorkflowPlan` into the `/api/v1/research` request or delete the class; a contract that reads like enforcement while nothing imports it is how the old project's `Memory.md` drifted from its code |
| P58 | **`workflow_jobs.parent_job_id` is read and never written.** `JobRepository.java:61` maps it into the record; neither insert (`:96-100`, `:122-126`) includes the column, so it is always NULL, and no fan-out code exists in either runtime. | the two INSERT statements against the column list in `V2__execution.sql:85,117,120` | The §C.5.1 prediction ("exists in the schema and is read by no code path") is confirmed and slightly worse: it *is* read, into a field that can never be non-null. Harmless today because the planner emits four sequential steps; it becomes misleading the first time someone builds per-source fan-out and finds the column already squandered |
| P59 | **`workflow_steps.retry_count` is never incremented, and the UI is told about it.** `StepRepository.java:47` reads the column, `Records.java:41` carries it, and `OperationsService.java:156` publishes `retryCount` on the step-history view. Nothing writes it. | grep `retry_count` over `backend/src/main` → three reads, zero writes | The real counter is `workflow_jobs.attempt_count` (`JobRepository.java:299`), so the honest number exists one table away. A history screen that shows `0` retries for a step that ran four times is the fabricated-zero class the audit's §5 item 10 condemns. Either write it from the reclaim path or stop returning it |
| P60 | **Snippet-containment verification was never ported.** The old rule — a snippet corroborates a field only if the value, or all its ≥ 3-character tokens, literally appear in it, else `isVerified:false` — has no implementation. The nearest thing is `research/prompts.py:241`, which puts matched names into a *critique prompt* and sets no flag. | grep `casefold() in` / `is_verified` over `ai-service/app`; no `provenance` package in `backend/src/main/java` | `validate.py:102` still defers to it by comment, and `DatasetAssembler.java:177-186` attributes a field only when the value *is itself* a tool-verified URL — which is a narrower test than the one the map claims. Field-level provenance is therefore "this row came from these sources", not "this value appears in this text" |
| P61 | **Two planned governance components do not exist: the pre-LLM content-quality gate and the per-domain policy store.** No `min_content_length` / `failure_patterns` / `required_patterns` check anywhere (`quality/validate.py` is per-field *after* extraction); no `source_domain_policy` or equivalent table in `V1`–`V5`, therefore no 60 s cache and no exact-host-then-parent-domain match. | grep both languages for the identifiers → hits only in `docs/audit/*` | Every page goes to Gemini regardless of whether it is a 40-char error shell, and policy cannot vary per domain at all. `workflow_plans.source_policy` is a JSON column read only for display (`WorkflowController.java:134`) |
| P62 | **There is no VERIFY step, and the verdict the graph already produces is discarded.** `contracts.py:285` carries the advance / retry-step / replan / terminate decision; Java never reads it. The executor handles four step types; the other eight ENUM members (`V2__execution.sql:54-55`) fail with `STEP_TYPE_UNIMPLEMENTED` (`WorkflowJobExecutor.java:160-165`), as does the `REPLAN` job type (`:129-134`). | handler registry in `WorkflowJobExecutor` against the schema ENUM | The critique loop is genuinely inside the Python graph (`graph.py:219-236`, `_critique` at `:290-316`) — so verification *happens*, it just cannot escalate back to the orchestrator. There is consequently no Java-side iteration or replan cap either (P62's second half): `maxLoops` is bounded only in Python (`state.py:148,160-167`) |
| P63 | **SSE is promised by three documents and implemented by none.** No `SseEmitter`, no `text/event-stream`, no `EventSource`, no `Last-Event-ID` handling — the string occurs once, in a CORS allow-list (`WebConfig.java:40`). | grep across `backend/src` and all frontend source dirs | `G-api-map.md:102,190-196,237`, `A-final-architecture.md:171` and `J-no-redis-job-architecture.md:269` all describe the endpoint. The durable log it would stream from is real and correctly ordered (P: `ActivityRepository.java:35-60` writes before any read, and `forRun(afterId)` exists), so this is a thin reader over existing code — but until it lands, the docs must not read as a spec of current behaviour |
| P64 | **`scripts/verify.sh:53` names four `*MySqlTest` classes; five exist.** `AuthenticationMySqlTest` was added in Phase 12 and never added to the gate, while the Phase 12 record and §1 both stated the MySQL check ran "five classes". | the `-Dtest=` list against the five files: `WorkflowQueue` 14 + `WorkflowRunLifecycle` 16 + `DatasetPlatform` 17 + `ExportProgress` 11 = **58** executed by the gate as written, against **75** MySQL-gated tests in the tree (`AuthenticationMySqlTest` is 17, and all five carry `@EnabledIfEnvironmentVariable(named = "FINALAGENT_TEST_MYSQL")`, so a plain `mvn test` skips rather than omits them) | So the 330 figure in the Phase 12 record is right *only* because a developer running that class by hand got it counted; the gate itself never runs it. A Phase 13 change to `SessionCookieFilter` or `SecurityConfig` can therefore be green on `verify.sh`. The count in the Phase 12 record described the intent, not the script, and this row is the correction |
| P65 | **Country and currency canonicalization were not ported.** No static ISO-3166 table and no currency-field name heuristic (`funding\|salary\|price\|revenue\|amount\|cost\|budget\|valuation`). `normalize.py` takes a field's type from the declared contract (`:89`); country validation compares a value against the run's own declared places (`:217`, `:283-294`, `validate.py:388-398`). | grep `iso.?3166\|alpha_2\|country_names` and the heuristic pattern over both runtimes → zero | "India" and "IN" in two sources stay two different values, and a funding figure is only typed currency if the schema says so. Correct per-run, non-canonical across runs |
| P66 | **`FUZZY_REVIEW` has no code path at all** — so the dedupe rule that "fuzzy is excluded from auto-merge" is satisfied by absence rather than by a guard. | grep `FUZZY` over `ai-service/app`, `backend/src`, migrations → zero hits | `dedupe.py:29-30` limits auto-merge to EXACT/NORMALIZED, which is the safe half of the old behaviour. Recorded because the reuse map's wording implies a filter line that does not exist |
| P67 | **`logout` discards the revocation result.** `AuthenticationService.java:207-210` calls `revoke(...)` and ignores its return, so a request to sign out that matched no row succeeds silently. | the statement against `SessionRepository.revoke`, which returns a count | `revokeFamily`'s count *is* logged, so the asymmetry is local. It is nonetheless the one place §C.1.6's "no silent swallow of revocation failures" is not honoured |
| P68 | **Canonical dedupe in ranking keeps the first-seen candidate, not the highest-scoring one.** `ranking.py:98-107` skips a URL whose canonical form was already seen; upstream kept the **max** similarity. | the loop body | With the floor at 0.55 (`relevance.py:114`) the loss is small, but result order now depends on the order the provider returned — the nondeterminism class `aggregation.py` was written to remove |
| P69 | **A URL's userinfo can be persisted.** Python's canonical *key* is built from `parts.hostname` so credentials drop out of the key (`canonical.py:47-53`), but the raw URL is stored, and Java's normalizer takes the host as everything up to the first `/` (`DatasetAssembler.java:303`), which keeps `user:pass@`. `dataset_sources.url` (`V3:155`) holds the URL as fetched. | both canonicalizers read end to end | Credential stripping is currently a log concern only (`SecretMaskingConverter.java:27-28`, `logging_setup.py:18`). A `https://name:token@host/` seen in the wild would land in the dataset and in any export of it |
| P70 | **One npm dependency is genuinely dead: `@radix-ui/react-label`.** `components/ui/label.tsx` is a hand-rolled `<label>` that imports no Radix primitive, and nothing imports the wrapper. | grep `@radix-ui/react-label` over `frontend/{app,components,lib,hooks}` → zero | The other eight unreferenced `components/ui/*` wrappers (`avatar`, `checkbox`, `dialog`, `dropdown-menu`, `progress`, `sheet`, `tabs`, and the radix `separator` use is a single screen) are **not** dead: they are the primitives Phase 13 wires. Only the label entry has no path to becoming used |
| P71 | **Search is `LIKE`-only, and dataset-level search does not exist.** No `FULLTEXT` in any of `V1`–`V5`; row search is `LOWER(r.search_text) LIKE ?` (`DatasetQueryRepository.java:181`) and `filter[field]` is `JSON_EXTRACT … LIKE` (`:221`). `DatasetRepository.list()` filters on status and workflow id only (`:327-336`) — no name/description/requirement search. | grep `FULLTEXT` (zero) and the two LIKE sites; `DatasetAssembler.java:207` documents the choice rather than fixing it | The audit's §5 item 10 was "unindexable LIKE over JSON"; the denormalized `search_text` column moved the scan off the JSON but kept it a scan. Fine at fixture size, unmeasured at a real one |

**And the one thing this phase disproved about itself.** An intermediate pass claimed the prompt
templates were excluded from the installed distribution, because
`[tool.setuptools.packages.find] include = ["app*"]` would not discover the `prompts/` directories that
have no `__init__.py`. That is wrong: `packages.find` searches namespace packages by default. Built and
listed the wheel — `app/requirements/prompts/requirement.md`, `app/research/prompts/{critique,research,submit}.md`
are all inside `finalagent_ai_service-0.1.0-py3-none-any.whl`. The lesson goes in the other direction
from the usual one: the stale `ai-service/finalagent_ai_service.egg-info/SOURCES.txt` lists no `.md` at
all and is not evidence of anything, because it predates every module in `app/research/`. A build
artefact in the working tree argued about packaging; the artefact was simply old.

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
| **B1** | `finalagent_dev` needed a MySQL account the application can connect as, or `/ready` could never return 200 and no queue test could run against a real database. | **RESOLVED 2026-09-29 at Phase 7.** The user supplied the native server's root credential, and a scoped account was created through it: `finalagent`@`127.0.0.1` with `GRANT ALL PRIVILEGES ON finalagent_dev.*` and `USAGE ON *.*` — nothing global, no `GRANT OPTION`, no other schema. `SELECT CURRENT_USER()` confirms the app connects as `finalagent`, `/api/v1/ready` reports `mysql UP`, and 30 integration tests now run against that server. Recorded here because *how* the queue was verified depends on it |
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
| MySQL | 9.6.0, service `MySQL96`, port 3306 | running, reachable, **application user `finalagent` created and in use** — `ALL PRIVILEGES ON finalagent_dev.*` only. The `mysql` CLI is at `C:/Program Files/MySQL/MySQL Server 9.6/bin/mysql` |
| Docker | — | **not installed**; nothing in `database/` or `deploy/` has been built |

### Running the workflow layer locally

The queue is off by default and needs one thing: a reachable MySQL. It does not need a workspace id —
`FINALAGENT_WORKSPACE_ID` was deleted in Phase 12, and a tenant now exists only because an account
registered one.

```bash
WORKFLOW_EXECUTION_ENABLED=true \
bash scripts/dev-backend.sh          # Flyway applies V1-V5, the worker starts claiming
curl -s -X POST localhost:8080/api/v1/auth/register \
     -H 'Content-Type: application/json' \
     -d '{"email":"you@test.invalid","password":"a-sufficiently-long-test-password"}'
     # → 201 + Set-Cookie: finalagent_session=…; HttpOnly; SameSite=Strict
```

To exercise the queue's locking, leases, duplicate keys, dataset queries, export checkpoints and the
whole credential path against a real database:

```bash
cd backend && FINALAGENT_TEST_MYSQL=true mvn test   # 330 tests, 75 of them MySQL-backed
cd backend && mvn test                              # 255 tests; the same 75 report as skipped
```

Those five classes write to the schema named in the root `.env`, in workspace
`00000000-0000-0000-0000-000000000ff1`, which they provision as a real `workspaces` row because V5
made that a foreign key, and they delete their own rows before and after each test. Point
`MYSQL_DATABASE` at a scratch schema before running them against a database you care about, and
**make sure no second backend is pointed at the same schema while they run**: another live worker polls
the same queue and will claim an export job a test is mid-cancelling, which surfaces as a cancellation
bug and a flaky lifecycle test rather than as a configuration mistake (P53, and the 30-second lease in
`application-mysql.properties` exists partly because of it). `scripts/verify.sh` reports the whole
MySQL check as `SKIP` with the reason when the variable is absent.

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
bash scripts/verify.sh                        # every layer; add FINALAGENT_TEST_MYSQL=true for the queue
bash scripts/verify.sh backend                 # one layer
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

**Phase 17 is complete; awaiting authorization for Phase 13 (the PirateAgentUI wiring) and for P54,
which should be authorized *before* it.** Phase 17 cleaned the tree and proved, by building a clone in a
directory with no reference repositories beside it, that **this project does not need the old project
folder to exist** (§2 Phase 17.3). It removed dead models, dead methods, 24 unused imports, a duplicated
validator, one unused dependency and a stale build directory — and corrected the `verify.sh` line that
had been running 58 MySQL tests where 75 exist. What it deliberately did **not** touch is the security
finding: P54 is a reachable SSRF in the one path that leaves this service under a name a scraped page
chose, wiring the frontend does not change it, and a live demonstration with a real Firecrawl key would
exercise it.

Phases have been directed out of
`M-phase-plan.md` order, and that drift is now worth stating precisely rather than in a footnote:

| Planned | Delivered | Where it went |
|---|---|---|
| Phase 3 — authentication | **not built** | the reason `FINALAGENT_WORKSPACE_ID` is a single-tenant stopgap, `created_by_id` has no FK, and `dataset_*.workspace_id` has none either |
| Phase 4 — requirement understanding | Phase 3 | `requirements/` in Python, `RequirementValidator` in Java |
| Phase 5 — schema generation | part, Phase 3 | `derive_extraction_schema` + `ExtractionSchemaValidator` |
| Phase 6 — job engine | **Phase 7** | `workflow/` — plan, run, step, job, worker, MySQL queue, retries, leases, cancellation |
| Phase 7 — source governance | mostly, Phase 5 (at fetch time) | `curation/` — robots, policy, ranking, dedupe, retry, aggregation. **Not** built: host-resolution SSRF and per-domain rate |
| **Phase 6 — browser planner / critique** | **Phase 6** (2026-09-30) | taken as two patterns inside the one existing research graph: `run_interact` verifies its own effect (`CHANGED` / `UNCHANGED` / `UNKNOWN`) and `critique_prompt` receives what was actually read. Upstream's three-agent topology, local Playwright, screenshot judging and CSP/automation evasion were **refused** |
| Phase 8 — data intelligence pipeline | **Phase 8** (2026-09-30) | `ai-service/app/quality/` behind `POST /ai/v1/quality/process`, executed as the `TRANSFORM` step and disposed of by `RowContractEnforcer` in Java |
| Phase 8's dataset persistence | **Phases 9 and 10** (2026-09-30) | `V3__dataset_platform.sql` — seven tables, the `SAVE` step that writes them, and nine read endpoints; Phase 10 completed the traceability through the same schema |
| Exports | **Phase 11** (2026-09-30) | CSV, JSON and XLSX as `workflow_jobs` rows with `job_type='EXPORT'` — the same claim, lease, heartbeat, sweeper and guarded terminal write that runs a step. `EXPORT` is a **job type**, not a fifth step: it enters no plan, and no run's status or progress moves because somebody downloaded one |
| Phase 11's history / activity / monitoring | **Phase 11** (2026-09-30) | `operations/` reads the tables the queue already writes: `GET /api/v1/workflows`, `/{id}/runs`, `runs/{id}/steps`, `/api/v1/activity` (cursor on the event id) and `/api/v1/monitoring` |
| **Phase 3 — authentication** (the plan's numbering) | **Phase 12** (2026-09-30) | `identity/` behind `config/SecurityConfig` — accounts, personal workspaces, membership roles, opaque revocable sessions in MySQL, and `FINALAGENT_WORKSPACE_ID` deleted. `V5`, because the slots the audit reserved for identity were taken by working code in Phases 9 and 11 |

Most valuable next candidates, in dependency order:

1. **The PirateAgentUI wiring (Phase 13).** Nothing in the browser speaks to any of this: ten routes
   exist, none reads `/api/v1/workflows`, `/api/v1/datasets`, `/api/v1/exports`, `/api/v1/activity` or
   `/api/v1/monitoring`, and there is no login screen even though Phase 12 created the thing a login
   screen needs. This is now the only layer standing between the build and a demonstrable end-to-end
   run, and every claim in §5 about "verified at the API boundary, not the user's" closes with it. The
   credential rules it must respect are already written down: cookies only, no token in a body, and a
   mutating request must carry `X-Requested-With`.
2. **SSE monitoring over the durable event log.** `activity_events` is already written before any
   broadcast, is cursor-addressable (`id > ?`), now carries `workflow.dataset.saved` and
   `export.completed` / `export.failed` events, and is served by `/api/v1/activity` as a polled cursor.
   The streaming endpoint is a reader over that same method rather than new plumbing. P63: three
   documents (`G-api-map.md:102,190-196`, `A-final-architecture.md:171`,
   `J-no-redis-job-architecture.md:269`) describe it as though it shipped, and one line of
   `WebConfig.java:40` allows a `Last-Event-ID` header nothing reads.
3. **Export-file and session-row retention.** Nothing sweeps `var/exports` and nothing prunes expired
   `auth_sessions`, so both grow without bound; `ON DELETE CASCADE` drops the records when a dataset
   goes and says so in V4, but the disk and the table are operator concerns until a job prunes them.
   This is a queue job too, for the same reason exports are.
4. **Membership administration.** `OWNER`/`EDITOR`/`VIEWER` are enforced on every request and set only
   by registration or a direct insert, so the demotion path the per-request membership re-read exists
   to support has no endpoint yet.
5. **Finish source governance where Python cannot reach: P54 first.** Resolve a cleared URL's *host*
   before fetch — private, loopback, CGNAT and link-local (including `169.254.169.254`) refused — and
   enforce `SearchStrategy.max_requests_per_domain_per_minute`, which is produced and reported but still
   consumed by nothing (P55). Phase 15's finding is sharper than the old phrasing: the guard is absent
   *and* `curation/robots.py::_fetch` already makes the unguarded outbound call, so this is not a feature
   to add later but a call already on the request path to gate. The same block would take the pre-LLM
   content-quality check and a per-domain policy store with it (P61), and inbound throttling with a real
   429 and `Retry-After` (P56).
6. **Provider backoff at the LLM layer** for 429/503. The web layer retries (`curation/retry.py`) and
   the queue retries (`Backoff`), but the Gemini client still surfaces a rate limit as an error —
   normal on a free tier capped at 20 requests/day, not an edge case.
7. **Right-size the budgets against one real run, and every read against one real size.**
   `WORKFLOW_STEP_TIMEOUT_MS=240000` inside `WORKFLOW_LEASE_SECONDS=300` was reasoned about, never
   measured: no step has ever collected from the live web here, Phase 8 added a second long call
   (`/ai/v1/quality/process`) under the same budget, Phase 6 made an unverifiable browser session
   visible, Phase 11 added two more unmeasured numbers (a filtered dataset read is a JSON scan nobody
   has timed, and an export's chunk size is the only thing between a large file and a held worker), and
   Phase 12 added a per-request session lookup whose cost has not been measured against a loaded suite.
8. **The small honest fixes Phase 15 left numbered, of which Phase 17 took three.** Done: the
   `WorkflowPlan` family is deleted rather than wired (P57), `AuthenticationMySqlTest` is in the gate by
   pattern (P64), and `@radix-ui/react-label` is out of `package.json` (P70). Still open, each a one-line
   decision — wire it or stop publishing it, never leave it reading as enforcement: stop publishing
   `retryCount` from a column nothing writes, or increment it on reclaim (P59); drop `parent_job_id`
   until fan-out exists instead of carrying an always-NULL column (P58); check the count `logout`'s
   revoke returns, since the rule this project wrote for itself is no silent revocation failure (P67);
   strip userinfo before a URL is persisted, which the log masking already does and the storage path
   does not (P69); and correct P63's three doc lines and P60's comment in `validate.py:102`, because a
   promise in prose is how the next phase inherits a gap it believes is closed.


Still open: **G1** (demonstration strategy), **G2** (narrowed again by Phase 6 — the API shape and
lifecycle are settled, and sessions are now verifiable in principle, but no live session has run here,
so whether a real one changes visibly and in time is still unmeasured; see §6), **L1**
(enrichment-repo licence position, and the Community Licence's competing-service bar on
`TheAgenticBrowser-main` — see `docs/control/THIRD-PARTY.md`), **S1** (who writes site playbooks),
**Q1** (is lexical relevance adequate) and **Q2** (should unreadable robots keep refusing), both of
which need live web access. **B1 is closed.** Nothing new is blocked on the database: it is reachable,
migrated, and the queue runs on it.

### Carried forward from Phase 2, still true

- The research graph is a **stateless in-process run**. It persists nothing, and since Phase 9 the
  save step does: `ResearchResult`'s records map onto `dataset_rows` with their
  `dataset_row_sources` join and `dataset_field_evidence` attributions. The per-record
  `verifiedByTool` flag the DTO already carried is what decides both, and it is never inferred
  (P36).
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
