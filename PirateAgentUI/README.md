# PIRATEAGENT — AI Data Intelligence Platform

PIRATEAGENT is an autonomous AI-powered web data intelligence and research platform.
Give it a natural-language prompt in plain English, and your AI Data Crew plans, searches, inspects permitted web sources, and delivers clean, structured, source-backed datasets with full provenance and export capabilities.

## Architecture & Visual Experience

1. **PirateAgent Landing Page (`/`)**:
   - Signature pirate & ocean aesthetic with floating drifting clouds, layered animated waves, and rocking research ship.
   - Restrained, clean header with direct `GET STARTED` navigation.
   - Immediate value proposition and concise 5-step workflow overview:
     `Prompt → AI Plan → Web Search → Extract → Clean Dataset`
   - Direct CTA navigation to the application dashboard (`/dashboard`).

2. **PirateAgent Application Platform (`/dashboard`)**:
   - Clean, professional AI data platform interface.
   - **Dashboard** (`/dashboard`): Natural-language prompt box, system metrics, active and recent workflows & datasets.
   - **New Research** (`/dashboard/research/new`): Prompt analysis → AI understanding → editable schema/filter/source plan → live execution.
   - **Live Workflow Execution** (`/dashboard/workflows/live`): Real-time stage checklist, live counters, interactive activity log, and pause/resume/stop controls.
   - **Workflows List & Detail** (`/dashboard/workflows`): Search, status filter, and detailed inspection.
   - **Datasets** (`/dashboard/datasets`): Interactive tables with search, sort, pagination, record selection, source evidence drawer, and CSV / JSON / Excel downloads.
   - **Sources** (`/dashboard/sources`): Visited sources table with domain verification, status badges, and detail drawer.
   - **History** (`/dashboard/history`): Historical workflow execution records with duration and re-run capabilities.
   - **Activity** (`/dashboard/activity`): Live activity feed and system log stream.
   - **Settings** (`/dashboard/settings`): Profile, appearance, and preference configuration.

## Getting Started

```bash
# Install dependencies
npm install

# Run the development server
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to explore the animated PirateAgent landing page and click **GET STARTED** to launch into the dashboard!

## Project Structure

```
app/
  (auth)/               Login and authentication pages
  dashboard/            Professional data platform application routes
  layout.tsx            Root layout with typography, metadata, and styles
  page.tsx              PirateAgent landing page
  pirate.css            Scoped styles and animations for pirate landing page
  globals.css           Tailwind base and design tokens for dashboard
components/
  landing/              Modular landing page components
    PirateLanding.tsx   Main landing page assembly
    PirateNavbar.tsx    Simplified top navigation with brand and CTA
    PirateHero.tsx      Hero section with headline, workflow strip, and CTA
    PirateBackground.tsx Animated wave layers, rocking ship, and drifting clouds
    GetStartedButton.tsx Signature double-outline action button
  layout/               Sidebar and topbar for dashboard
  dashboard/            Dashboard overview widgets and metrics
  research/             Contract builder and prompt configuration
  workflow/             Live simulation controls and timeline
  dataset/              Data grids, evidence drawer, and export controls
  common/               Shared components (Logo, etc.)
  ui/                   Reusable UI primitives
public/
  pirate/
    images/             Ship SVG, wave textures, clouds, and favicon
```
