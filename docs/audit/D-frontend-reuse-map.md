# D. Frontend Reuse Map

Source: `AI-Powerd Data Intelligence/PirateAgentUI`. Target: `FINALAIAGENT/frontend/`.
Mandate: **preserve the visual system exactly; remove demo/template behaviour; render only real
backend data.**

Headline: this frontend has **already been de-mocked**. `mock-data.ts` no longer exists and
nothing imports it (verified by search). `Memory.md:330`'s claim of "Zero Mock Dependencies" is
therefore accurate. What remains is subtler and more dangerous: **fabricated fallback values
inside real API-connected components**, which make missing data look like good data.

---

## D.1 Design system — authoritative tokens

**`md files/Design.md` is superseded.** It specifies a white/blue `#3B5BFF` Inter system in a
"Linear/Vercel/Notion" idiom. The shipped UI is a warm parchment-and-brown nautical theme with
serif display type. Since the brief requires preserving PirateAgentUI, **the CSS below is the
design system of record**; `Design.md` must be rewritten from it (or deleted).

### Colors — `app/globals.css:6-43` (light, `:root`; HSL triplets as authored, hex from the
inline comments)

| Token | HSL | Hex | Role |
|---|---|---|---|
| `--background` | `38 33% 86%` | `#E8DFCF` | page background (warm parchment) |
| `--foreground` | `34 10% 14%` | `#26231F` | body text (deep charcoal) |
| `--card`, `--popover` | `40 46% 95%` | `#F8F4EC` | cards, popovers |
| `--surface`, `--accent` | `37 39% 91%` | `#F1EADF` | sidebar, warm beige surfaces |
| `--border` | `36 24% 72%` | `#C8BBA7` | all borders |
| `--input` | `36 24% 76%` | `#D4C7B5` | input backgrounds |
| `--ring`, `--primary`, `--accent-foreground` | `20 38% 25%` | `#5A3928` | primary actions, focus rings (dark brown) |
| `--primary-hover` | `21 40% 19%` | `#472C1E` | primary hover |
| `--primary-foreground` | `40 46% 96%` | `#FAF6EE` | text on primary (cream) |
| `--primary-soft` | `38 30% 88%` | `#ECE3D5` | soft primary fill |
| `--muted` | `37 28% 82%` | `#DED4C4` | muted surfaces |
| `--muted-foreground` | `38 9% 36%` | `#655F55` | meta / secondary text |
| `--success` / `--success-soft` | `141 34% 34%` / `140 27% 92%` | `#39744E` / `#E6F0EA` | completed, valid |
| `--warning` / `--warning-soft` | `35 66% 37%` / `38 57% 92%` | `#9E6920` / `#F7EFE0` | duplicate, flagged, partial |
| `--danger` / `--danger-soft` | `8 52% 43%` / `9 48% 95%` | `#A64434` / `#F9ECE9` | failed, invalid |
| `--info` / `--info-soft` | `201 33% 36%` / `203 31% 93%` | `#3D657A` / `#E6EEF3` | running, processing (nautical slate) |
| `--radius` | `8px` | — | base radius |

Extra literals in `tailwind.config.ts:48-50`: `tan: #B78B62`, `warm-brown: #8B5A3C`,
`dark-brown: #5A3928`. **`tan` is the signature accent** — used for icons, hover borders
(`hover:border-tan/60`), and the notification dot.

Dark theme — `globals.css:45-72` (`.dark` class): background `34 10% 12%`, card `34 10% 16%`,
primary/ring `29 38% 55%` (lighter brown), success `141 34% 48%`, warning `35 66% 50%`,
danger `8 55% 55%`, info `201 40% 50%`, with matching `-soft` variants near 18% lightness.

> **Defect:** nothing ever adds the `.dark` class. There is no `next-themes`, and the settings
> theme picker only sets local component state (`settings/page.tsx:32`). **Dark mode is
> defined but unreachable.** Fix by adding `next-themes` with `attribute="class"` — the palette
> already exists, so this is wiring, not design work.

Base layer (`globals.css:75-90`): global `border-border`, smooth scroll,
`font-feature-settings: "cv11","ss01"`, selection `bg-primary/20`, plus `.scrollbar-thin` (6px)
and `.no-scrollbar` utilities.

### Typography — `tailwind.config.ts:8-23`, loaded via Google Fonts in `app/layout.tsx:22`

| Family | Weights | Usage |
|---|---|---|
| **Inter** (`sans`) | 400/500/600/700 | all body text; `<body className="font-sans">` |
| **Cormorant Garamond** (`serif`) | 500/600/700 + italic 600 | **all headings and large numbers** — the recurring pattern is `font-serif text-2xl font-bold tracking-tight` |
| **JetBrains Mono** (`mono`) | 400/500 | URLs, JSON, IDs |
| **Jost** + Cormorant Garamond | — | landing page only (`app/pirate.css:2,10-11`) |

Observed type scale (not tokenized — record it so it is not lost): body 13-13.5px; labels
11.5-12px `uppercase tracking-wider font-semibold text-muted-foreground`; page headings
`font-serif text-2xl md:text-3xl font-bold tracking-tight`.

### Radius, shadow, motion — `tailwind.config.ts:52-73`

- Radius: `lg = var(--radius)` (8px), `md = radius-3px` (5px), `sm = radius-5px` (3px),
  `xl = radius+4px` (12px)
- Shadows: `subtle: 0 1px 2px 0 rgba(15,17,21,.04)`;
  `card: 0 1px 3px 0 rgba(15,17,21,.06), 0 1px 2px -1px rgba(15,17,21,.04)`
- Keyframes: `accordion-down/up` (0.2s), `fade-in` (0.2s), `pulse-soft` (2s infinite)
- Motion conventions: framer-motion stagger `0.06`, item `y: 10 → 0` over `0.3s`

### Layout conventions (observed, must be preserved)

Card `p-4`/`p-5 rounded-lg border-border bg-card shadow-subtle`; page container
`max-w-6xl mx-auto`; main padding `px-4 py-6 md:px-8 md:py-8`; sidebar fixed `w-60` (240px);
topbar sticky `h-14 bg-surface/80 backdrop-blur-md`.

> **Defect:** several components use classes that do not exist in Tailwind v3 or in this config
> and therefore silently render nothing — `shadow-xs` (card headers, live-stats, login icon),
> `h-4.5`/`w-4.5` (`settings/page.tsx:122,152`), `translate-x-5.5` (`settings/page.tsx:153`).
> Decide deliberately: add them to the config, or replace with real values. Do not carry
> no-op classes forward unnoticed.

### Landing theme — `app/pirate.css`, scoped to `.pirate-theme-root`

Variables (`:5-11`): header height 4.5rem (5.5rem ≥1150px), `--pirate-body: hsl(40,33%,86%)`,
`--pirate-black: hsl(40,14%,14%)`, `--pirate-first: hsl(40,24%,64%)`,
`--pirate-white: hsl(40,31%,89%)`.
Signature button (`:87-160`): pill, 2.5px black border, inner 2px border ring, hard
`box-shadow: 0 5px 0` → 7px on hover with a -2px lift → 1px + 3px on active.
Hero title `clamp(3.4rem, 7vw, 5.8rem)` serif, line-height 0.94.
Animated background: ship rock 2.2s (`pirate-ship` keyframes ±8deg), 3 wave layers 4.5s linear
infinite in opposite directions, 2 clouds 12s; breakpoints at 767px / 768-1149px / 1150px+
(`:355-448`). Assets: `public/pirate/images/{cloud.svg, pirate-ship.svg, waves-1..3.png,
favicon.png}`.

---

## D.2 COPY AS-IS (the visual foundation — do not modify)

| Path | Contents |
|---|---|
| `app/globals.css`, `app/pirate.css` | full token set, base layer, landing theme |
| `tailwind.config.ts`, `postcss.config.js` | font families, tan/warm-brown/dark-brown, radius, shadows, keyframes |
| `app/layout.tsx` | Google Font loading, metadata, `Providers` |
| `public/pirate/images/*` | ship, 3 wave layers, cloud, favicon |
| `components/ui/*` | avatar, badge (7 variants), button (6 variants × 4 sizes + `loading` prop), card, checkbox, dialog, dropdown-menu, input, label, progress (Radix, `bg-primary` on `bg-muted`, `h-1.5`), separator, sheet, skeleton, tabs, textarea |
| `components/icons/*` | 14 custom pirate SVGs: AnchorCheck, Anchor, Cargo, Compass, CrossedAnchor, HistoryScroll, Lighthouse, NauticalInstrument, SailingShip, ShipLog, ShipWheel, Spyglass, TreasureChest, TreasureMap (+ `index.ts`) |
| `components/common/*` | `logo.tsx` (anchor SVG in a primary rounded square), `status-badge.tsx` (5 statuses, spin on running/planning), `empty-state.tsx`, `pagination.tsx` (first/prev/numbered/next/last) |
| `components/layout/sidebar.tsx` | fixed `w-60`; NAV array (`:17-25`) Dashboard, New Research, Workflows, Datasets, Sources, History, Activity + Settings pinned bottom; active = `bg-card` + border + `text-primary` icon |
| `components/landing/*` | `PirateLanding`, `PirateNavbar` (scroll-reactive), `PirateHero`, `PirateBackground`, `GetStartedButton` |
| `lib/utils.ts` | `cn()` and formatters |
| `hooks/use-count-up.ts` | rAF count-up animation (cosmetic, already driven by real values) |
| Presentational shells | `dashboard/stat-card.tsx` (icon tile + serif number, 5 tones), `workflow/stage-checklist.tsx` (7 stages, connector line, status icons), `workflow/activity-log.tsx`, `workflow/live-stats.tsx`, `dataset/data-table.tsx`, `dataset/source-drawer.tsx`, `research/plan-preview.tsx`, `dashboard/prompt-box.tsx`, `dashboard/recent-*.tsx`, `workflow/workflow-run-view.tsx` |

---

## D.3 ADAPT (keep the pixels, rewire the data)

| Path | Change required |
|---|---|
| `next.config.js:15-22` | Replace the hardcoded `http://localhost:4000` rewrite with an env-driven target (`NEXT_PUBLIC_API_URL` / `API_PROXY_TARGET`). Keep the legacy `redirects()` (`:4-14`) |
| `lib/api.ts` | Keep the fetch wrapper, `ApiError` shape and single-retry refresh (`:66-165`). Make `BASE_URL` (`:15`) env-driven. **Move tokens out of `localStorage`** (`:21-22`) into httpOnly cookies, or add a `middleware.ts` guard — see D.5 |
| `lib/auth.tsx` | Keep the `AuthProvider` API (`user`, `loading`, `login`, `register`, `logout`, `refreshUser`). Route guarding is currently client-side only (`:144-152`); add server-side protection |
| `hooks/use-api.ts` | Replace with **TanStack Query**. The current hook is bare `useState`/`useEffect` with **no caching, no polling, no dedupe, no invalidation, no window-focus refetch** |
| `hooks/use-sse.ts` | Solid: real `EventSource`, `lastEventId` resume, terminal-event close. **Add reconnect/backoff** — `onerror` currently only sets `connected=false` (`:50` notes it replaced the old `useWorkflowSimulation`) |
| `app/dashboard/**` pages | Swap client-side aggregation, client-side pagination and status mapping for real endpoints. Remove every fabricated fallback (D.4) |
| `components/workflow/workflow-run-view.tsx:59-78` | "Pause" actually calls `POST /runs/:id/cancel` (`live/page.tsx:251-261,278`) — **rename it to Cancel**. "Resume" (`onResume` never passed), "Stop" (just navigates away) and "Retry" (no handler) are **dead buttons**: wire them to real endpoints or delete them |
| `components/layout/topbar.tsx:46-52,55-61` | Global search input has no handler or state (decorative); the bell has a static `bg-tan` dot with zero data behind it. Wire both or remove both |
| `components/research/plan-preview.tsx` | Currently renders a **static 7-step pipeline list**. Must render the actual plan DAG returned by `POST /workflows/plan` — this is the visible proof that natural language drives the workflow |

---

## D.4 DELETE / REBUILD

| Path | Why |
|---|---|
| `lib/export.ts` (entire file) | Complete client-side CSV/JSON/XLS-HTML builders — **dead code**, superseded by backend export jobs in `dataset/export-menu.tsx:30,38`. Also violates "frontend contains no business logic" |
| `lib/constants.ts:18-23` | `EXAMPLE_PROMPTS` includes **"Find 200 AI startups in India with founder, website, funding and LinkedIn"** — the last remnant of the demo schema. Replace with product-neutral examples covering genuinely different entity types (jobs, sponsors, channels, pricing). The same string is duplicated as a placeholder in `components/dashboard/prompt-box.tsx:49` and `app/dashboard/research/new/page.tsx:198` |
| `app/dashboard/settings/page.tsx` | **Fully fake.** Theme picker (`:32-34,88`) sets local state only, never applies `.dark`, never persists. "Save changes" and "Save preferences" (`:170`) have **no `onClick` at all**. `defaultSourceCap="50"` and `autoDedupe=true` are hardcoded and never sent anywhere. Rebuild against real `user_preferences` persistence |
| `recharts` dependency | Declared but **never imported anywhere**. Remove, or wire it to real dataset statistics |
| N+1 fetch loops | `sources/page.tsx:51-78` fetches *every* dataset's sources (`limit=100` each) and dedupes by ID in a client `Map`, because no global `/sources` endpoint exists. `activity/page.tsx:129-157` loops workflows and fetches each run's activity sequentially. Both must become single backend endpoints |
| `README.md:59` | Still says "workflow/ Live **simulation** controls" — stale doc from the pre-SSE era |

---

## D.5 Fabricated data inside real components (must be removed)

These are the highest-priority fixes: the components call real APIs, then **invent values when
the response is incomplete**. The user sees a confident number that does not exist.

| # | Location | Fabrication |
|---|---|---|
| 1 | `app/dashboard/datasets/[id]/page.tsx:120-131` | Row normalization invents data: **default confidence `90`** (`:122-123`), synthetic `sourceIds` **`src-1…src-n`** generated from a count (`:127`), `isValid ?? true` (`:129`), `collectedAt` falls back to `now` |
| 2 | `components/dataset/data-table.tsx:74-77` | Same confidence-90 default; `sourceCount ?? 1` |
| 3 | `components/dataset/source-drawer.tsx:47` | Same confidence-90 default |
| 4 | `app/dashboard/research/new/page.tsx:112-116` | If the backend returns no fields, the frontend **invents a data contract** `[{name:"name"},{name:"website"}]`; `targetCount \|\| 100` (`:109`); local `normalizeFieldType` mapping (`:47-53`) |
| 5 | `app/dashboard/workflows/live/page.tsx:89-92,102` | Stage-checklist state **synthesized client-side**: before events arrive, stage 0 = "done", rest = "pending"; progress computed as `(idx+1)/stages.length*100` — not backend truth. Log timestamps use `new Date()` when events lack them (`:114,275`) |
| 6 | `app/dashboard/workflows/[id]/page.tsx:99-110` | All 7 stages marked uniformly done/pending from the final run status; fallback log entry `"Workflow created"` with a now-timestamp (`:110`); **duplicate identical fetch** of `/workflows/:id` (`:47-55`) |
| 7 | `app/dashboard/activity/page.tsx:86-111` | Human-readable messages synthesized client-side in `formatActionMessage` when the backend sends none |
| 8 | `app/dashboard/page.tsx:75-78` | Stat cards sum only the **first 10 datasets** (`limit:10`) — misleading pseudo-statistics presented as totals |
| 9 | `workflows/page.tsx:79`, `history/page.tsx:55-66` | `progress ?? (completed ? 100 : 0)`; history derived by client-side filtering of `/workflows` |

**Rule for the rebuild:** when a value is absent, render an explicit "—" or "not recorded".
Never substitute a plausible number. The backend must also stop fabricating (the old
`datasets.routes.ts:240-251` invented the *same* confidence-90 and `src-N` values server-side,
so both sides of the contract were lying).

---

## D.6 Business logic that must move to the backend

1. **Progress and stage computation** from raw events — `workflows/live/page.tsx:89-224`
   (progress formula at `:102`, stage-advancement rules, counter maxing). The backend must emit
   authoritative `progress` and `stage` fields.
2. **Status-taxonomy mapping, duplicated three times** — `workflows/page.tsx:46-54`,
   `components/dashboard/recent-workflows.tsx:77-87`, `history/page.tsx:74-79`. Backend
   `ACTIVE/DRAFT/PAUSED/ARCHIVED` plus run `RUNNING/COMPLETED/PARTIAL/FAILED/CANCELLED` are each
   mapped to UI `running/completed/failed/paused`. Return a single `displayStatus`.
3. **Aggregation and statistics** — dashboard totals (`dashboard/page.tsx:75-78`), source
   aggregation + dedupe (`sources/page.tsx:66-75`), activity merge/sort/slice
   (`activity/page.tsx:133-157`). Requires new `/stats`, `/sources`, `/activity` endpoints.
4. **Data-quality coercion** — confidence 0-1 vs 0-100 handling
   (`datasets/[id]/page.tsx:121-123`). Pick one unit (recommend 0-1 internally, formatted at
   render) and enforce it in the contract.
5. **Response-shape reconciliation** — the UI hedges between `raw.fields ?? raw.columns`,
   `r.data ?? r.values`, and `recordsValid / recordsAccepted / validCount` across dozens of
   `??` chains. That hedging exists because the API contract is unstable. Fix the contract, then
   delete the hedging.
6. **Export file construction** (`lib/export.ts`) — already replaced; delete.
7. **Human-readable event messages** (`activity/page.tsx:86-111`) — the backend should send
   `message`.

Requirement parsing is correctly backend-side already (`POST /requirements/parse`); only the
invented-fallback contract (D.5 #4) leaks logic to the client.

---

## D.7 State management notes

- Server state: `hooks/use-api.ts` — fetch-on-mount, no cache. Replace with TanStack Query.
- Live run status: **real SSE** via `hooks/use-sse.ts`. The 800ms `setTimeout` in
  `live/page.tsx:227-241` is a one-shot hydration retry for a missing `datasetId`, **not** a
  simulation.
- Deletions are optimistic via `deletedIds` arrays (`workflows/page.tsx:62`,
  `datasets/page.tsx:37`, `history/page.tsx:45`) rather than cache invalidation — with
  TanStack Query, use proper invalidation.
- Pagination is **client-side** on workflows (fetch `limit:100`, slice 6/page), datasets
  (100 → 6/page), sources (all → 10/page) and activity (100 → 10/page). Only dataset rows
  paginate server-side (`PAGE_SIZE=20`). Move all of it server-side.
- **No `TODO`/`FIXME`/`HACK` comments exist** (verified). The unfinished work is behavioural,
  not annotated — which is why it survived review.
- **No `NEXT_PUBLIC_*` or `process.env` reference exists anywhere** in the frontend (verified).
  Good for secret safety; bad for configurability. Add `NEXT_PUBLIC_API_URL` only.

---

## D.8 Security items to fix while rewiring

1. **JWTs in `localStorage`** (`lib/api.ts:21-22`) are readable by any XSS. Move to httpOnly
   cookies, or accept the risk explicitly and add a strict CSP.
2. **SSE passes the token as a query parameter** (`hooks/use-sse.ts:87-88`,
   `?token=` at `:93`). Query strings land in proxy logs, browser history and server access
   logs. Prefer a short-lived single-use stream ticket issued over the authenticated REST
   channel, or cookie-based auth for the SSE endpoint.
3. **Route guarding is client-side only** — dashboard pages are client components that redirect
   after hydration (`lib/auth.tsx:144-152`), and there is no `middleware.ts`. Content is still
   protected by the API, but add server-side guarding so the shell is not briefly rendered.

---

## D.9 Route inventory to preserve (18 routes)

| Route | File | Data status today |
|---|---|---|
| `/` | `app/page.tsx` | static marketing (by design) |
| `/login`, `/signup` | `app/(auth)/*/page.tsx` | **real** (`POST /auth/login`, `/auth/register`) |
| `/dashboard` | `app/dashboard/page.tsx` | real fetches, but stats computed client-side over 10 datasets |
| `/dashboard/research/new` | `…/research/new/page.tsx` | real, with an invented fallback contract |
| `/dashboard/workflows` | `…/workflows/page.tsx` | real; client-side filter + pagination |
| `/dashboard/workflows/live` | `…/workflows/live/page.tsx` | real SSE; stage/progress synthesized |
| `/dashboard/workflows/[id]` | `…/workflows/[id]/page.tsx` | real; stages synthesized, duplicate fetch |
| `/dashboard/datasets` | `…/datasets/page.tsx` | real |
| `/dashboard/datasets/[id]` | `…/datasets/[id]/page.tsx` | real, with fabricated fallbacks |
| `/dashboard/sources` | `…/sources/page.tsx` | real, N+1 aggregation |
| `/dashboard/history` | `…/history/page.tsx` | real, derived client-side |
| `/dashboard/activity` | `…/activity/page.tsx` | real events, N+1 assembly |
| `/dashboard/settings` | `…/settings/page.tsx` | **fully fake** |
| layouts / providers | `app/layout.tsx`, `app/(auth)/layout.tsx`, `app/dashboard/layout.tsx`, `app/providers.tsx` | static shell |

All 8 screens required by the product (New Research, Workflow Preview, Workflow Running,
Workflow History, Dataset Explorer, Source Explorer, Export, Activity Log) already exist
visually. **No new screens are needed** — the work is contract-driven rewiring plus removal of
fabrication.

---

## D.10 What the frontend requires from the new backend

For this UI to be genuinely data-driven, the backend must provide:

1. The 23 endpoints it already consumes (enumerated in `G-api-map.md`).
2. **Three new aggregate endpoints** to kill the N+1 patterns: `GET /stats`,
   `GET /sources` (workspace-global), `GET /activity` (workspace-global).
3. The **15 SSE event names** it already switches on: `STAGE_STARTED`, `STAGE_COMPLETED`,
   `SOURCE_DISCOVERY_STARTED`, `SOURCE_DISCOVERED`, `SCRAPE_STARTED`, `SCRAPE_COMPLETED`,
   `SOURCE_PROCESSED`, `SOURCE_FAILED`, `EXTRACTION_STARTED`, `RECORDS_EXTRACTED`,
   `RECORDS_COLLECTED`, `VALIDATION_COMPLETED`, `DEDUPLICATION_COMPLETED` / `DEDUP_COMPLETED`,
   `DATASET_CREATED`, and the terminal trio `RUN_COMPLETED` / `RUN_FAILED` / `RUN_CANCELLED`
   (`hooks/use-sse.ts:121-134`). Note the duplicate
   `DEDUPLICATION_COMPLETED`/`DEDUP_COMPLETED` — the backend emitted one name, the UI hedged for
   both. **Pick one.**
4. A stable envelope: `{data, pagination:{total,page,limit,totalPages}}` for lists and
   `{error:{code,message}}` for failures.
5. Authoritative `progress`, `stage`, `displayStatus` and `message` fields, so the client stops
   computing them.
6. **One** name per concept: `values` (not `data`), `columns` (not `fields`), `validCount`
   (not `recordsValid`/`recordsAccepted`), confidence as a single unit.

Next: `E-database-model.md`.
