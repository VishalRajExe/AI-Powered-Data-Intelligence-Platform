# Design.md — Visual Design System
### Project: Scoutly

> This file defines **HOW IT LOOKS**: theme, colors, typography, spacing, components, and states. It does not define features (`PRD.md`) or technical structure (`Architecture.md`). Every page must be built consistently with these tokens — do not improvise new colors, spacing, or component styles per page.

---

## 1. Design Philosophy

Scoutly is a **data-intelligence tool**, not a marketing site. The UI should feel like a calm, professional analyst's workspace: dense enough to show real data, but never cluttered. Think "modern B2B SaaS dashboard" — closer to Linear/Vercel/Notion in restraint than to a colorful consumer app.

Principles:
- **Clarity over decoration.** Every color and visual weight should communicate status or hierarchy, not decorate.
- **Data is the hero.** Tables, numbers, and progress indicators should never compete visually with chrome/navigation.
- **Calm motion.** Loading and progress states should feel alive (data is being worked on) without being distracting.

## 2. Theme

- **Base mode:** Light theme as default, with a full dark-mode variant (respect `prefers-color-scheme`, user-toggleable).
- **Layout shell:** Fixed left sidebar (nav: New Task, Workflows, Datasets, Sources, Activity, Settings) + main content area, consistent across all authenticated pages.

## 3. Color Palette

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--bg-primary` | `#FFFFFF` | `#0B0D10` | Page background |
| `--bg-secondary` | `#F7F8FA` | `#14171C` | Sidebar, cards background |
| `--bg-elevated` | `#FFFFFF` | `#1B1F26` | Modals, dropdowns |
| `--border` | `#E4E7EB` | `#2A2F38` | Card/table borders |
| `--text-primary` | `#0F1115` | `#F2F3F5` | Headings, primary text |
| `--text-secondary` | `#5B616E` | `#9AA1AC` | Secondary/meta text |
| `--brand-primary` | `#3B5BFF` | `#5C7CFF` | Primary actions, links, active nav |
| `--brand-primary-hover` | `#2E48D9` | `#7A94FF` | Hover state of primary |
| `--success` | `#16A34A` | `#4ADE80` | Completed status, valid records |
| `--warning` | `#D97706` | `#FBBF24` | Duplicate/flagged/partial |
| `--error` | `#DC2626` | `#F87171` | Failed status, invalid records |
| `--info` | `#0891B2` | `#22D3EE` | Running/processing status |

Status colors are used **consistently everywhere** a status appears (workflow status, row validity, source accepted/skipped) — never repurposed for anything else.

## 4. Typography

- **Font family:** `Inter` (UI text) + `JetBrains Mono` or `IBM Plex Mono` for anything tabular/technical (source URLs, raw JSON, confidence scores), loaded via Google Fonts / self-hosted variable font.
- **Scale:**
  | Level | Size | Weight | Usage |
  |---|---|---|---|
  | H1 | 28px | 600 | Page titles ("Datasets", "Workflow: AI Startups India") |
  | H2 | 20px | 600 | Section headers within a page |
  | H3 | 16px | 600 | Card titles |
  | Body | 14px | 400 | Default UI text |
  | Small | 12px | 400 | Meta text, timestamps, helper text |
  | Mono | 13px | 400 | URLs, JSON, IDs |
- Line height: 1.5 for body text, 1.2 for headings.

## 5. Spacing & Layout

- Base spacing unit: **4px**. All margins/padding are multiples of 4 (4, 8, 12, 16, 24, 32, 48).
- Page content max-width: 1280px, centered, with 24px horizontal padding on smaller viewports.
- Standard card padding: 16px (compact) or 24px (spacious, e.g. empty states).
- Grid gap between cards: 16px.

## 6. Borders, Radius & Elevation

- Border radius: **8px** for cards/buttons/inputs, **6px** for small chips/badges, **12px** for modals.
- Border width: 1px solid `--border`, no heavy drop shadows — use subtle `box-shadow: 0 1px 2px rgba(0,0,0,0.04)` for elevated surfaces (cards on hover, dropdowns).
- Avoid gradients except a very subtle one on primary CTA buttons if desired; default to flat fills.

## 7. Core Components

### Buttons
- Primary: filled `--brand-primary`, white text, 8px radius, 10px/16px vertical/horizontal padding.
- Secondary: outline `--border`, `--text-primary` text.
- Destructive: outline or filled `--error`, used only for delete/cancel-workflow actions.
- Disabled: 40% opacity, no hover state.

### Cards
- `--bg-secondary` background, 1px `--border`, 8px radius, 16–24px padding.
- Used for: dataset summary cards, workflow summary cards, stat tiles.

### Tables (Dataset Explorer)
- Sticky header row, `--bg-secondary` header background, `--text-secondary` header text (12px, uppercase, letter-spacing 0.02em).
- Zebra-free (rely on 1px row borders, not alternating background) for a cleaner data-dense look.
- Row hover: `--bg-secondary` background tint.
- Cell overflow: truncate with ellipsis + tooltip on hover for long text (URLs, descriptions).
- A dedicated "Sources" column/badge (e.g., "3 sources") that opens the source drawer on click.

### Status Badges
- Small pill, 6px radius, colored background at 12% opacity of the status color + full-opacity text/dot of that color.
- States: `Completed` (success), `Running` (info, with a subtle pulsing dot), `Failed` (error), `Duplicate` (warning), `Pending` (secondary/gray).

### Progress Indicators (Workflow Monitor)
- Stage checklist: vertical list of stages (Planning, Source Discovery, Extraction, Cleaning, Validation, Deduplication), each with a checkmark (done), spinner (active), or empty circle (pending).
- Per-stage progress bar where applicable (e.g., "Scraping 37/50 sources"), using `--info` fill.
- Live counters (Records found / Valid / Duplicates removed) shown as small stat tiles above or beside the stage checklist, updating in real time.

### Filters / Search Bar
- Persistent top bar above the dataset table: free-text search input (left) + dropdown filter chips (right, one per filterable field), each showing active filter count as a badge.

### Source Drawer / Modal
- Slide-in panel from the right when inspecting a row's evidence.
- Each source listed as a small card: favicon/domain, title, retrieved timestamp, a short snippet, and a link icon to open the original page.

## 8. States

- **Loading:** Skeleton loaders (gray animated blocks) matching the shape of the content being loaded — never a generic full-page spinner for content that has a known layout (tables, cards).
- **Empty state:** Centered icon + short headline + one-line explanation + a primary CTA (e.g., "No datasets yet" → "New Task" button). Never just a blank page.
- **Error state:** Inline, human-readable message with a retry action where applicable (e.g., "This workflow failed to reach 2 sources — view details" rather than a raw error dump).
- **Success state:** Subtle toast/snackbar (bottom-right) for confirmations (e.g., "Export ready — downloading…"), auto-dismissing after ~4s.
- **Partial/degraded state:** Explicitly distinguished from full success — e.g., a workflow that completed with some sources skipped shows a "Completed with warnings" badge, not a plain green "Completed."

## 9. Responsive Behavior

- Breakpoints: mobile `<640px`, tablet `640–1024px`, desktop `>1024px`.
- Sidebar collapses to a bottom nav bar or hamburger drawer below `1024px`.
- Dataset tables become horizontally scrollable (with a sticky first column, e.g. entity name) rather than reflowing into cards below `768px` — data density is preserved over reflow.
- Workflow monitor stage checklist stacks vertically at all breakpoints (it already is vertical) but stat tiles switch from a row to a 2-column grid on mobile.

## 10. Iconography

- Use a single consistent icon set throughout (e.g., Lucide icons) — no mixing icon libraries.
- Icons are functional, not decorative: status icons, action icons (export, refresh, expand), and navigation icons only.
