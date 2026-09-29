# N. Old Project — Broken Scripts and Dependency Audit

Adds the area `00-FORENSIC-AUDIT.md` under-covered: the old project's **toolchain as actually
installed today**. Everything here was **executed**, not inferred. Date: 2026-09-29.

Headline: **the old project does not typecheck, lint, or fully test in this working copy.**
Its `Memory.md` records the opposite. The cause is a broken install, not broken source — which
matters, because it means every "green" figure carried forward from that project is unverified.

---

## N.1 What was run, and what happened

| Command | Exit | Result |
|---|---:|---|
| `npm run typecheck` | **1** | **FAIL — 10 × `TS2307: Cannot find module '@aidp/firecrawl-agent-core'`** |
| `npm run lint` (backend) | **1** | **FAIL — 14 errors, 0 warnings** |
| `npm run lint:frontend` | **1** | **FAIL — 32 errors, 0 warnings** |
| `npm run test` | **1** | **FAIL — 3 of 20 test files cannot load; 195 passed, 7 skipped (202 collected)** |
| `npm ls --depth=0` | 0 | Both workspaces reported `invalid: "file:…"`; nearly every package `extraneous` |
| `node_modules/@aidp/*` inspection | — | Both entries are **real directories with 0 entries**, not workspace links |

Failing test files: `tests/agent.test.ts`, `tests/requirements.test.ts`, and one more suite, all
via the same unresolved import.

---

## N.2 Root cause: the npm workspace links are dead

`node_modules/@aidp/firecrawl-agent-core` and `node_modules/@aidp/backend` are **empty
directories**, not symlinks/junctions (`lstat`: `isSymbolicLink: false`, `readdir → 0`). Neither
has a `package.json` or `dist/`.

The lockfile is **not** at fault — `package-lock.json` (v3) correctly records both as workspace
links (`"link": true, "resolved": "backend"`), with zero `file:` protocol specs.

What broke it:

- A workspace root install coexists with **nested installs** — `backend/node_modules/`,
  `packages/firecrawl-agent-core/node_modules/`, `PirateAgentUI/node_modules/` all exist.
- `backend/node_modules/@aidp/` does not exist at all, so the workspace dependency is only
  reachable through the (empty) root link.

On Windows, workspace linking needs symlink or junction creation; without developer mode /
privileges npm can leave exactly this state. Re-creating it is `npm install` at the **root only**.
Not done here — this is an audit of the checkout as delivered.

`backend/dist/` still holds 84 compiled files with no `src/` file newer than it, so a build
**did** succeed at some point while the links were alive. The recorded green results describe
that earlier state, not this one.

---

## N.3 Claim vs. measured — old `md files/Memory.md`

| Claim | Line | Measured now |
|---|---:|---|
| "213 automated tests pass across 18 test suites" | 11, 244, 298 | **195 passed / 202 collected, 3 suites fail to load** |
| "ESLint passes with 0 errors/warnings" | 11, 298 | **backend 14 errors, frontend 32 errors** |
| "TypeScript typechecks cleanly (`tsc --noEmit`)" | 11, 298 | **10 errors, exit 1** |
| "production build succeeds" | 11, 298, 332 | Cannot — same resolution failure; only stale `dist/` |
| "Frontend `next build` exits 0 errors across all 15 routes" | 333 | **Not tested** (would write `.next/`) — recorded as unverified |

This is the same failure mode already flagged in `00-FORENSIC-AUDIT.md` §3, now with a second
class of evidence: not just docs contradicting code, but **docs contradicting the toolchain**.

---

## N.4 Broken / missing scripts

| Finding | Evidence |
|---|---|
| `backend/src/scripts/check-apis.ts` is an **orphan** — no npm script invokes it | `grep -rn "check-apis" package.json` → no match, root or backend |
| Frontend has **no `typecheck` script** | `pirateagent` scripts = `dev`, `build`, `start`, `lint`. Types only checked as a side effect of `next build` |
| `docs:generate` exists in `backend` but is **not surfaced at root** | Root mirrors `db:*`, `demo*`, `test:db` but not `docs:generate` |
| Root `lint` and `lint:frontend` both fail, so neither can gate CI | Exit 1 on both |
| No `npm run verify`-style aggregate — 8 separate scripts must be chained by hand | Root `package.json` scripts block |

---

## N.5 Dependency findings

**Real problems:**

| # | Finding | Detail |
|---|---|---|
| D1 | **Dead workspace links** | N.2 — the one that actually breaks the build |
| D2 | Stale `@types/bcryptjs@2.4.6` alongside `bcryptjs@3.0.3` | v3 ships its own types (`umd/index.d.ts`); the v2-era DT package shadows them. Delete `@types/bcryptjs` |
| D3 | `recharts` declared in frontend, **never imported** | Confirmed across `app/`, `components/`, `lib/` |
| D4 | Nested + root installs coexist | Desync source; `npm ci` at root would behave differently from what's on disk |
| D5 | `.kilo/worktrees/extreme-apogee/` — a **25 MB duplicate** of the project *and* all four reference repos | Excluded only by `.git/info/exclude` (local, **not shared on clone**); absent from `.gitignore`. A fresh clone shows it as untracked |

**Explicitly NOT a defect** (checked before reporting): `backend` statically imports none of
`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@langchain/anthropic`, `@langchain/google`,
`@langchain/google-genai`, `@langchain/openai` — only `@ai-sdk/google`. This is **correct**:
the vendored core declares all seven as `peerDependencies`, and `ai` resolves providers
dynamically, so the consumer must install them. Do not "clean these up".

**Deliberate exact pins, all consistent:** `ai@6.0.293`, `zod@3.25.76`, `typescript@5.9.3`,
`prisma@6.12.0` / `@prisma/client@6.12.0`, `vite@6.4.3`, `bullmq@6.3.9`,
`@aidp/firecrawl-agent-core@0.1.0-vendor.1` (matches the workspace's own version — no link
mismatch). The upstream `web-agent-main` core pins `firecrawl-aisdk@0.12.0-beta.2`, a **beta** —
already logged as a risk; FINALAIAGENT avoids it by never depending on that package.

---

## N.6 Why this still matters to FINALAIAGENT

The stack changes, so D1 does not transfer — there is no npm workspace to unlink in a
Java + Python + independent Next.js layout. What transfers is the **process defect**: green
statuses were written into the project's memory file and never re-verified against a clean
install, so a false quality baseline propagated.

Three rules follow, already reflected in `M-phase-plan.md` exit criteria:

1. Every phase's "tests pass / typecheck clean / build succeeds" claim must be produced by a
   command run **in that session**, and the count reported, not asserted.
2. Each phase record states **which checks were skipped** and why (as Docker absence already
   forces for Testcontainers — `00-FORENSIC-AUDIT.md` §8).
3. A single `verify` entry point per service, so "did you run everything" has one answer.

Reproduce the above with:

```bash
cd "D:/privateagent-java/AI-Powerd Data Intelligence"
npm run typecheck && npm run lint && npm run lint:frontend && npm run test
node -e "const fs=require('fs');for(const p of ['node_modules/@aidp/backend','node_modules/@aidp/firecrawl-agent-core'])console.log(p,fs.readdirSync(p).length,'entries')"
```
