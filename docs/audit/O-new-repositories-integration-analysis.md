# O. New Reference Repositories — Integration Analysis

Phase 1.5. Inspection and comparison only: **no code was written, no Phase 2 work started, no
frontend modified, no repository deleted.** Date: 2026-09-29.

Scope: `data-enrichment-js-main` and `ai-data-enrichment-agent-main`, read as actual source,
compared against the Phase 0 architecture (A–N) and the Phase 1 foundation.

---

## O.1 Verdict, stated before the evidence

**One of these two repositories is worth studying closely. The other is worth ~15 lines of
inspiration and a cautionary note.**

| | Real content | Licence | Decision |
|---|---|---|---|
| `data-enrichment-js-main` | 691 lines of TS across 6 modules. A genuine plan → act → **critique** → re-loop graph with an enforced turn cap and configurable bounds. | `"license": "MIT"` in `package.json:7` **only**; no LICENSE file, no source headers, no SPDX/copyright string anywhere | **Adapt 1 idea, port to Python.** Reject both I/O paths. |
| `ai-data-enrichment-agent-main` | 166 lines, one file. An agent loop with **no** validation, **no** bound, **no** test, and no error handling. | **No licence at all** — not in a file, not in a manifest (there is no manifest), not in the README | **Concepts only** (default copyright reserve). Contributes nothing we lack. |

Neither repository changes the three-runtime architecture. Neither justifies a fourth (Node)
service. Details in O.6 and O.8.

---

## O.2 A. What `data-enrichment-js` already solves

Verified by reading every file under `src/` and `tests/`:

1. **A schema-injection convention that works.** The user's extraction schema is bound as a
   *dummy tool* — `tool(async () => {}, { schema: state.extractionSchema })` (`graph.ts:52-56`) —
   with an empty body that is never executed; the extraction payload is read off
   `tool_call.args` (`graph.ts:83`). `tool_choice: "any"` (`graph.ts:62-64`) forces the model to
   emit schema-shaped output rather than prose. **Zero hardcoded field names exist anywhere in
   `src/`** — `grep` confirms no `founder`/`funding`/`company`/`india`; those appear only in
   `tests/agent.int.test.ts:10-29` and README examples, as caller-supplied input. This is exactly
   the "prompt determines the schema" property the brief demands, and the template enforces it
   structurally rather than by convention.
2. **A semantic critique node.** `reflect` (`graph.ts:155-225`) makes a **second** model call
   against `InfoIsSatisfactory` (`graph.ts:114-136`: `reason[]`, `is_satisfactory`,
   `improvement_instructions`) via `withStructuredOutput`, then converts the verdict into a
   `ToolMessage` with `status: "success" | "error"` and loops back on `"error"`
   (`graph.ts:203-224`, `graph.ts:282-284`).
3. **An enforced turn bound** — `loopStep` is a summing reducer (`state.ts:79-82`), incremented by
   1 per agent turn (`graph.ts:107`), and `routeAfterChecker` ends the run at
   `loopStep >= maxLoops`, default 6 (`graph.ts:273`, `configuration.ts:61`). Search depth is
   configurable too (`maxSearchResults`, default 5).
4. **Fail-loud on broken assumptions.** Both routers `throw` with the actual received type when
   the last message is not what they require (`graph.ts:162-166`, `graph.ts:277-280`) instead of
   silently continuing.
5. **Per-call error isolation.** `toolNode` runs all tool calls concurrently via `Promise.all` and
   converts a thrown tool error into an error-status `ToolMessage` (`tools.ts:101-138`), so one
   bad URL does not abort the batch.

It does **not** solve: schema *generation* (input schema is user-supplied, unmodified — there is
no prompt→schema stage at all), record-level validation, deduplication, entity resolution,
evidence/provenance, persistence, tenancy, or governance.

## O.3 B. What `ai-data-enrichment-agent` already solves

Essentially the same loop, stripped down, and it solves less than its README claims:

- `enrich()` (`enrichment_agent.py:139-146`) takes `topic + extraction_schema` → returns **one**
  dict. Single-record enrichment, not N-row dataset collection.
- Termination signal is a dynamically-built `submit_info` tool whose `parameters` are the schema
  (`:94-98`), routed on `state.info` truthiness (`:113-126`).
- **No validation of the submitted args** against the schema — no `jsonschema`, no Pydantic, no
  required-key check. README line 11 promises "Returns structured JSON matching your schema";
  the code never checks it. Another doc-vs-code gap of the kind catalogued in `00` §3.
- **No bound.** `route` can return `"agent"` indefinitely; no counter exists anywhere in the file.
- `str(content)[:20000]` (`:57`) truncates scraped HTML mid-page with no marker.
- `if not state.messages` (`:117`) is unreachable after the first agent turn.
- No tests, no CI, no error handling, no retries, no timeouts, no robots, no provenance.
- Requires `langchain-brightdata` (`requirements.txt:2`) — see O.5.

Its only distinctive idea over the JS template: **`submit_info` args as the loop's exit
condition**, expressed in ~8 lines. We already have that, in stronger form, as the
`formatOutput`-blocked-until-data gate ported from `web-agent-main` (`F` §F.7).

## O.4 The critique pattern is the real find — and its two flaws are instructive

Adopting `reflect` is the single substantive change this analysis recommends. Why it matters to
us specifically: our designed extraction has a **deterministic** schema gate (`H` §H.4, ported
`schema-validate.ts`) that checks *shape*, and a plan-level VERIFY stage that checks *run*
outcome (`F` §F.8). Neither catches "shape correct, content hollow" — every required field
present, all of them vague or empty. A completeness critic inside the loop closes that gap.

Copy it, and fix the three defects found in it:

| Defect | Evidence | Our version |
|---|---|---|
| The bound only guards the `reflect` exit. A run that keeps calling `search`/`scrapeWebsite` never reaches `routeAfterChecker`, so `maxLoops` never applies; only LangGraph's implicit recursion limit would stop it. | `graph.ts:234-254` routes tools→agent with no counter check | Bound enforced in the executor on **every** path, in Java, as a persisted step counter — the Phase 0 lesson from `TheAgenticBrowser` (`C` §C.4: "No hard iteration cap — do the opposite") |
| Loop exhaustion returns `__end__` as if the run had succeeded. | `graph.ts:289-290` | Exhaustion is **FAILED or COMPLETED_WITH_WARNINGS** with the critique's `improvement_instructions` persisted as the reason. Never a silent green |
| `improvement_instructions` is not in `required` (`graph.ts:134`), so an unsatisfactory verdict can yield `"Unsatisfactory response:\nundefined"` | `graph.ts:217` | When `is_satisfactory=false`, instructions are required by the schema; a critique with no actionable feedback is a validation failure |

Two more of its flaws we design out rather than inherit: `reason` says *"Must include at least 3
reasons"* **only in a description string** (`graph.ts:121`) — no `minItems`, so unenforced; and
`checker_prompt` is hardcoded inline (`graph.ts:185-190`) and is **not configurable**, while the
main prompt is.

## O.5 F. What Firecrawl already solves — and G. what would become duplicate

The user's instruction anticipated this; the code confirms it.

| Capability | `data-enrichment-js` | `ai-data-enrichment-agent` | Firecrawl / our design | Ruling |
|---|---|---|---|---|
| Web search | `TavilySearch` (`tools.ts:8,39`) — a **second** search provider, API key required | `BrightDataSERP`, Google SERP, `country="us"`, 5 results (`:32-38`) | `firecrawl.search` (`I` §I.2) | **Reject both.** One engine |
| Scrape | Bare `await fetch(url)` → `.text()` → `slice(0,50000)` → **another LLM call** to "jot down notes" (`tools.ts:44-70`) | `BrightDataUnlocker(data_format="markdown")`, described as *"bypassing anti-bot protection"* (`:40-43`) | `firecrawl.scrape` with markdown + targeted extract, in one call | **Reject both.** Ours is stronger and cheaper |
| Structured extraction | dummy-tool schema binding + `tool_choice:"any"` | `submit_info` with schema as `parameters` | already designed: `plan.extractionSchema` → Gemini `response_schema` + the `schema-validate` gate (`H` §H.4) | **Already solved by us**; adopt the naming convention, not the code |
| Search→scrape decision | LLM chooses, `routeAfterAgent` | LLM chooses, `route` | Spring plan DAG (`F` §F.4) | Ours is more auditable; keep |
| Critique / completeness | **yes — the valuable part** | no | partially (plan-level VERIFY) | **Adopt the idea** |

**Bright Data is not adopted, in any form.** Two independent reasons:

1. Redundant — Firecrawl covers search, scrape and interact (`I` §I.2, evidence-backed).
2. **Governance conflict.** This repository's own comment describes `BrightDataUnlocker` as
   *"bypassing anti-bot protection"* (`enrichment_agent.py:40`). FINALAIAGENT's plan contract
   fixes `allowAuthentication=false` and `allowCaptchaBypass=false` as **Java constants the model
   cannot edit** (`F` §F.4), and `Rules.md` §2 forbids bypassing access controls. Adopting that
   engine would make our safety literals a lie. The brief allows Bright Data only "if a genuine
   capability is missing"; none is.

The `fetch`-based scraper deserves a specific warning: it performs a raw request to a
**model-chosen URL** with no SSRF guard, no robots check, no timeout, no user-agent, no redirect
policy — and **never checks `response.ok`**, so a 404 or a bot-block page is summarised by the
LLM as if it were source content, then cited as evidence. That is the exact failure class our
`SsrfGuard`, `RobotsPolicyService` and tool-observed-URL rule exist to prevent.

## O.6 C/D/E. Direct reuse, port to Python, or keep in TypeScript

- **C. Directly reusable as code: nothing.** `data-enrichment-js` is MIT *declared* but with no
  licence text present (O.7), and it depends on LangChain/LangGraph/Tavily packages that are not in
  our stack. There is no file we can drop into `FINALAIAGENT` and keep working.
- **D. Port to Python: the critique loop only** — as a gate inside the extraction step of
  `ai-service/app/extraction/`, plus its feedback-into-next-turn routing. Losslessly expressible:
  `loopStep` reducer → integer, `withStructuredOutput` → Gemini `response_schema`, `ToolMessage`
  status → a typed result.
- **E. Remaining in TypeScript: nothing.** This is the decision the brief explicitly asked me to
  consider ("reuse directly if a small TypeScript agent component is justified"). It is not
  justified, and the evidence is concrete: `workflow.compile()` is called with **no checkpointer**,
  nothing in `src/` touches disk, and the three nodes plus two routers are a plain while-loop over
  a message list with a counter. A Node service would exist to run ~700 lines of LangGraph
  wrapping logic we can express in Python — reintroducing the fourth runtime Phase 0 rejected on
  the same grounds (`A` §A.1). **Phase 0's three-runtime decision stands.**

## O.7 Reuse map additions (same six columns as `C`)

| Repository | Useful feature | Source path | Actual implementation | Method | Destination |
|---|---|---|---|---|---|
| data-enrichment-js | Critique/reflection gate on extracted info | `src/enrichment_agent/graph.ts:114-136,155-225,266-291` | Second model call with structured output `{reason[], is_satisfactory, improvement_instructions?}` → synthetic `ToolMessage(status:"success"｜"error")` → route back to the agent on error. Verdict is an **LLM opinion**, never a data check | **PORT (adapt)** to Python; fix the three defects in O.4 | `ai-service/app/extraction/critique.py` + `backend/.../engine/steps/` bound enforcement |
| data-enrichment-js | Feedback injected into the next research turn | `graph.ts:199-224` | The critique text re-enters the message list as a tool message the agent then reads | **PORT (pattern)** | `ai-service/app/extraction/loop.py` |
| data-enrichment-js | Schema bound as a forced-output tool | `graph.ts:52-56,62-64,83-91` | `tool(async () => {}, {schema: state.extractionSchema})`, never executed; payload read from `tool_call.args`; `tool_choice:"any"` forces schema-shaped output. **Args are never validated against the schema** | **ALREADY SOLVED** — keep our `response_schema` + `schema-validate` gate, which does validate | no change (`ai-service/app/extraction/schema.py`) |
| data-enrichment-js | Turn bound `maxLoops`, configurable bounds | `state.ts:79-82`, `graph.ts:107,273`, `configuration.ts:59-61` | Summing reducer + `loopStep >= maxLoops` end. **Only guards the reflect exit path** | **PORT (concept)** — enforce on every path in Java, persisted | `backend/.../engine/StepBudget.java` |
| data-enrichment-js | Fail loudly on violated graph assumptions | `graph.ts:162-166,277-280` | `throw new Error(... received type)` instead of defaulting | **PORT (discipline)** | both services |
| data-enrichment-js | Concurrent tool execution with per-call error isolation | `tools.ts:101-138` | `Promise.all` over `tool_calls`; thrown errors become error-status tool messages, never raised | **ADAPT** — keep isolation, but a failure must also mark the step degraded, not just the message stream | `ai-service/app/firecrawl/client.py` |
| data-enrichment-js | Search via Tavily | `tools.ts:8,39-42` | Second search provider, extra key, extra cost | **REJECT** — duplicates `firecrawl.search` | — |
| data-enrichment-js | Scrape via raw `fetch` + LLM notes | `tools.ts:44-70` | No `response.ok` check, no robots, no SSRF guard, no timeout, `slice(0,50000)` of raw HTML, then a **second LLM call per page** | **REJECT** — weaker and riskier than Firecrawl | — |
| data-enrichment-js | `__state` injected into every tool's args | `tools.ts:108-114` | `args: { __state: state, ...call.args }` — and `grep` shows **nothing reads `__state`**. Dead code that contradicts the tool's own `additionalProperties:false` | **DROP** | — |
| data-enrichment-js | `maxInfoToolCalls` configuration | `configuration.ts:35,60` | Declared and defaulted to 3; **never read anywhere** | **DROP** — the same dead-config defect recorded for anakin's `MAX_JOB_RETRIES` | — |
| data-enrichment-js | Prompt/tool-name agreement | `prompts.ts:13-14` vs `tools.ts:73` | Prompt advertises `` `Search` `` and `` `ScrapeWebsite` ``; registered names are Tavily's default and `scrapeWebsite` | **Lesson** — assert tool names in tests; ours must match | `ai-service/tests/test_prompts.py` |
| data-enrichment-js | Template-based prompt construction | `graph.ts:68-69,178-179`, `tools.ts:60-65` | `.replace(str, str)` interprets `$&`, `` $` ``, `$1` in the **replacement**, so a schema or topic containing those sequences corrupts the prompt | **Lesson** — use placeholder tokens + `split/join` (literal) in Python | `ai-service/app/llm/prompts/` |
| data-enrichment-js | CI wiring | `package.json:24`, `.github/workflows/unit-tests.yml:40-41` | `lint:all` joins steps with `&` (background), not `&&`, so lint failures **cannot fail CI** | **Lesson** — `scripts/verify.sh` chains with `&&` and exits non-zero | already built |
| ai-data-enrichment-agent | Topic + schema entry shape | `enrichment_agent.py:139-146` | `enrich(topic, schema) -> dict`. Clean contract, single record | **IGNORE** — our Requirement contract is richer | — |
| ai-data-enrichment-agent | `submit_info` args as loop terminator | `enrichment_agent.py:94-98,113-126` | Builds a tool whose `parameters` are the raw schema; exits when `state.info` is truthy. No validation | **ALREADY SOLVED**, stronger — our gate requires data-tool evidence first | — |
| ai-data-enrichment-agent | Bright Data SERP + Unlocker | `enrichment_agent.py:32-43`, `requirements.txt:2` | Google SERP scraping; unlocker described as *"bypassing anti-bot protection"* | **REJECT** — duplicates Firecrawl **and** conflicts with `allowCaptchaBypass=false` | — |
| ai-data-enrichment-agent | Content truncation | `enrichment_agent.py:57` | `str(content)[:20000]`, mid-page, unmarked | **IGNORE** — we use documented 4000/2000 limits | — |

## O.8 H. Final AI architecture

Unchanged in shape; one gate added. The brief's pipeline maps onto the existing design as:

```
USER PROMPT
  └─ AI REQUIREMENT ANALYZER ......... ai-service/app/llm (Gemini response_schema)   [H §H.3]
       └─ STRUCTURED REQUIREMENT ...... Requirement contract, Java re-validates        [F §F.3]
            └─ DYNAMIC DATA CONTRACT .. dataset_columns from requirement.fields        [E]
                 └─ EXTRACTION SCHEMA .. plan.extractionSchema, JSON Schema, no const  [F §F.4, H §H.4]
                      └─ WORKFLOW PLANNER .. 2-attempt validate→correct, DAG bounds    [F §F.4]
                           └─ SOURCE STRATEGY .. queries + domain policy + relevance    [C §C.1.4]
                                └─ FIRECRAWL (Spring-cleared URLs only) → search/scrape/interact
                                     └─ STRUCTURED EXTRACTION
                                          ├─ gate 1  schema-validate + bounded repair (3)   ← existing
                                          ├─ gate 2  no answer before data-tool evidence    ← existing
                                          └─ gate 3  COMPLETENESS CRITIQUE  ← NEW, from O.4
                                               └─ unsatisfactory → feedback into next turn
                                                  (bounded on every path; exhaustion = degraded, never green)
                                    └─ DATA ENRICHMENT (per-field source attachment)
                                         └─ NORMALIZE → VALIDATE → DEDUPE → ENTITY RESOLVE → CONFLICT
                                              → SOURCE/EVIDENCE → MySQL → frontend
```

Requirement / extraction schema / workflow plan / data intelligence remain four distinct
artifacts, exactly as the brief separates them. **No second schema-generation stage is added**:
the schema derives from `requirement.fields`, which the LLM produces from the prompt, which is
already "dynamically generated from the user's natural-language request". Adding a second
topic→schema LLM step would produce two schemas to reconcile — the duplicate-functionality failure
the brief warns against.

Gates 1 and 2 catch a fabricated or malformed shape. Gate 3 catches a well-shaped but thin result.
All three are **advisory in Python and re-enforced in Java**, per the Phase 0 split.

## O.9 I / J / K — document changes

**I. `Architecture.md`** (to be written in Phase 2 from `A-final-architecture.md`): add gate 3 to
the extraction stage of the request flow (`A` §A.3); state the web-access ruling in one line —
*"Firecrawl is the sole web engine; Bright Data and Tavily were evaluated in Phase 1.5 and
rejected, the latter also on governance grounds"*; and record that the critique loop's bound is
enforced by Spring, not by the model or a framework default.

**J. `Phases.md`:** gate 3 belongs to **Phase 8 (Collection & extraction)**, as an exit criterion
added to it — an extraction step is incomplete unless a completeness critique, bounded and
feedback-driven, is enforced on every path. No new phase; the schema and auth work deferred out of
Phase 1 still needs placing (schema phase, and Phase 3 as planned).

**K. `Memory.md`:** three decisions (below), three bugs-not-to-copy, and one blocking question —
whether "MIT declared in `package.json` with no licence text present" is acceptable for adapted
logic. It already applies to `web-agent-main` (`L` R2); this analysis adds a second instance.

## O.10 What must not change

- Three runtimes; no Node agent service (O.6, evidence-backed).
- Firecrawl as sole web engine (O.5).
- Spring owns orchestration, governance, persistence; Python is stateless.
- No Redis. MySQL job table + `ThreadPoolTaskExecutor`.
- Safety literals (`allowCaptchaBypass=false`, `respectRobotsTxt=true`) stay Java constants the
  model cannot edit — this is the clause Bright Data would have violated.
- No hardcoded schema defaults; `data-enrichment-js`'s zero-hardcoded-fields property is
  corroborating evidence for a rule we already have, not a new rule.

## O.11 New risks

| ID | Risk | Mitigation |
|---|---|---|
| R28 | **Adapting `data-enrichment-js` logic rests on a `package.json` licence claim with no licence text.** Same class as R2, now twice | Ask upstream, or re-implement from this behavioural description without translating their source. Record the choice either way |
| R29 | **`ai-data-enrichment-agent-main` has no licence at all** → default copyright reserve. Anyone copying its code creates real exposure | Concepts only. State this in `THIRD-PARTY.md` before Phase 2 |
| R30 | A critique gate adds **one LLM call per extraction round**, multiplying token cost on the most expensive path | Hard bound (reuse `max_schema_repairs`-style config), run it only when gate 1 passes, and measure cost in the Phase 2 spike |
| R31 | An LLM judge can rate thin-but-confident data as satisfactory | Deterministic gate 1 stays mandatory and first; critique can only *add* work, never approve alone |
| R32 | Both reference agents produce **one record**; our platform needs N rows with dedup and entity resolution | Do not let the enrichment loop redefine our record contract; it validates a batch, not an entity |

## O.12 How `data-enrichment-js` becomes the main research graph

The follow-on master instruction names this repository the primary AI/research foundation and asks
that the graph architecture be preserved rather than collapsed into a single LLM call. It is
preserved. The mapping below is exact, and it keeps Firecrawl as the only web engine.

The resolution to the "two orchestrators" worry is **two nesting levels, not two competing ones**:

| Level | Owner | Scope | Persisted? |
|---|---|---|---|
| **Outer** — plan DAG (`SEARCH → SCRAPE → EXTRACT → VALIDATE → … → SAVE`) | Spring Boot, from the validated `WorkflowPlan` | which step runs, when, with what retries, and whether it is allowed to touch the network | yes — `workflow_steps` / `workflow_jobs` |
| **Inner** — research graph (`callModel ⇄ tools → critique`) | Python, **inside one `EXTRACT` step** | how to fill one extraction schema from sources Java already cleared | no — ephemeral, bounded, and it emits records + evidence upward |

Spring never re-implements the research loop, and Python never decides whether a step runs.

| `data-enrichment-js` | FINALAIAGENT destination | What changes | Firecrawl's role |
|---|---|---|---|
| `callAgentModel` (`graph.ts:43-109`) | `ai-service/app/research/graph.py::call_model` | Schema still bound as a forced-output tool, but the payload is then validated by gate 1 (`schema-validate`) — theirs never is | the model chooses among Java-cleared Firecrawl tools only |
| `tools` node (`tools.ts:92-142`) | `ai-service/app/firecrawl/client.py` | `TavilySearch` and the raw `fetch` scraper are **deleted**, replaced by `firecrawl.search` / `firecrawl.scrape` / `firecrawl.interact`. Concurrent execution and per-call error isolation are kept | every network call |
| `Info` dummy tool (`graph.ts:52-56`) | `ai-service/app/extraction/schema.py` | Kept as the forcing mechanism. `plan.extractionSchema` supplies it, so it is dynamic per prompt and never a fixed template | none |
| `reflect` critique (`graph.ts:155-225`) | `ai-service/app/extraction/critique.py` — **gate 3** | Feedback re-enters the next turn as in the original; verdict schema gains required `improvement_instructions` when unsatisfactory, and `minItems` on the reasons | none |
| `routeAfterAgent` (`graph.ts:234-254`) | `graph.py::route_after_model` | Unchanged logic: `Info` → critique, otherwise → tools | none |
| `routeAfterChecker` (`graph.ts:266-291`) | enforced in **Spring** as `StepBudget`, not only in Python | Bound applies on **every** exit path, and exhaustion returns `FAILED`/`COMPLETED_WITH_WARNINGS` with the critique text as the reason — never a silent success | none |
| `state.ts` (`messages`, `topic`, `info`, `extractionSchema`, `loopStep`) | `app/research/state.py` | Same fields, plus `records[]`, `cleared_sources[]`, `evidence[]`. `info` is **one record**; ours is a **batch**, because the platform produces datasets, not single enrichments | sources feed `cleared_sources` |
| `configuration.ts` (`maxLoops`, `maxSearchResults`) | Spring-supplied per step, from the plan | `maxInfoToolCalls` dropped (never read); every bound the plan declares is actually enforced | caps real requests per domain |
| `prompts.ts` (`MAIN_PROMPT`, `INFO_PROMPT`) | `app/llm/prompts/research.md` | Kept as generic scaffolding, extended with our anti-fabrication and evidence wording. `checker_prompt`, currently hardcoded at `graph.ts:185-190`, becomes a real template | — |

**Deliberately not carried over:** the demo `topic`/schema fixtures, Tavily, the `fetch`-based
scraper, single-record `info`, unvalidated submission, the `__state` argument injection, and
`additionalProperties: false` violated by that same injection.

**Extension the template does not have, and the platform requires:** after the graph returns
records, results pass through normalize → validate → dedupe → entity-resolve → conflict →
per-field evidence, then Java re-validates the contract before MySQL. Source provenance is captured
*inside* the loop (which tool returned which URL), not reconstructed afterwards.

**Open, for Phase 2:** depend on the `langgraph` PyPI package, or express this graph as a plain
Python state machine. The evidence says nothing here needs the runtime — no checkpointer, no disk
writes, no interrupts — so a state machine keeps the topology without a new heavy dependency.
Either satisfies the instruction; the decision is recorded as **L2** rather than made silently.

## O.13 Stop

Analysis only. **No Phase 2 work started, no features built, no frontend modified, no reference
repository deleted.** The Phase 1 working tree is untouched by this analysis apart from this file
and the `Memory.md` / `README.md` / `C` cross-references.

Awaiting authorization for: (1) the O.9 document edits, (2) gate 3 as a Phase 8 exit criterion,
(3) a ruling on **L1** (R28/R29 licences) and **L2** (LangGraph dependency vs plain Python state
machine), and (4) Phase 2 itself.
