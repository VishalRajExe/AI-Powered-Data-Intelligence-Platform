# PRD.md — Product Requirements Document
### Project: Scoutly — AI-Powered Data Intelligence Platform

> This file defines **WHAT** we are building and **WHY**. It does not describe how the system works technically (see `Architecture.md`), what technical rules apply (see `Rules.md`), the build order (see `Phases.md`), or visual design (see `Design.md`). If a fact belongs in one of those files, it is intentionally left out of this one.

---

## 1. Problem Statement

Businesses, NGOs, researchers, and analysts constantly need specific, structured information collected from the web — job listings, sales leads, sponsorship opportunities, market/competitor data, pricing, company directories, etc. Today this requires either:

- Manually researching and copy-pasting data (slow, error-prone, doesn't scale), or
- Hiring engineers to build a bespoke scraper/workflow for every single request (expensive, brittle, not reusable, breaks when sites change).

There is no self-serve system where a non-technical user can simply **describe what data they need in plain English** and receive a **clean, structured, source-verifiable dataset** without writing a single line of code or configuring a scraper.

## 2. Product Vision

Scoutly turns a natural-language data requirement into a fully managed, autonomous data-collection pipeline. The user types a request; an AI agent plans and executes a multi-step research workflow across permitted web sources; the platform cleans, validates, deduplicates, and stores the results; and the user explores, filters, and exports the resulting dataset from a central dashboard — with every data point traceable back to its original source.

**One-line pitch:** "Describe the data you need. Scoutly finds it, verifies it, and hands you a clean dataset."

## 3. Target Users

| User type | Need |
|---|---|
| **Growth / Sales teams** | Lead lists (companies, contacts, funding, industry) |
| **Recruiters / Job seekers** | Aggregated job openings matching specific criteria |
| **Sponsorship / Partnerships teams** | Lists of events, orgs, or programs open to sponsorship |
| **Market / competitive analysts** | Pricing, feature, or positioning data across competitors |
| **Researchers / Journalists** | Structured facts gathered from many public sources with citations |
| **Founders / Operators** | Any one-off "find me all X that has Y" business question |

All target users are assumed **non-technical** with respect to scraping — they should never need to know what a "selector," "crawler," or "API schema" is.

## 4. Core Use Cases

1. **Submit a data request in plain English.**
   _"Find 300 AI startups founded in India after 2020 with founder name, website, funding raised, and LinkedIn URL."_
2. **Watch the request turn into a live, monitored workflow** (planning → source discovery → collection → extraction → cleaning → validation → deduplication → dataset ready).
3. **Browse the resulting dataset** in a searchable, filterable table.
4. **Inspect any single record** to see exactly which source page(s) it was derived from, when, and with what confidence.
5. **Export** the full dataset or a filtered subset as CSV / JSON / Excel.
6. **Revisit past requests** — see workflow history, re-run a workflow, or duplicate it with modified parameters.
7. **Monitor an in-progress workflow's status**, including partial results, errors, and retry/skip decisions per source.
8. **Manage multiple datasets** across multiple past and ongoing requests from one dashboard.

## 5. Functional Requirements

### 5.1 Natural-Language Understanding
- FR-1: The system must accept a free-text prompt describing a data requirement.
- FR-2: The system must convert the prompt into a structured **data contract**: target entity type, required fields, filters/constraints, and (if inferable) approximate desired record count.
- FR-3: If the prompt is too ambiguous to produce a data contract, the system must ask a clarifying follow-up rather than guessing silently.

### 5.2 Workflow Planning & Execution
- FR-4: The system must dynamically generate a multi-step collection workflow tailored to the data contract (no hardcoded per-request-type pipelines).
- FR-5: The workflow must be able to search, scrape, and (when necessary) interact with pages across multiple independent sources.
- FR-6: The workflow must run steps in parallel where targets are independent (e.g., many companies to research at once).
- FR-7: Execution must be observable in real time (live status, not just a final result).
- FR-8: Failed or blocked sources must be skipped gracefully without failing the entire workflow, with the failure reason recorded.

### 5.3 Source Governance
- FR-9: The system must only collect from sources that are technically and legally accessible (respecting robots.txt and site terms where applicable — see `Rules.md` for the exact policy).
- FR-10: Every collected data point must retain a reference to its originating source URL and retrieval timestamp.

### 5.4 Data Processing
- FR-11: Raw extracted data must be normalized (consistent casing, date formats, currency, phone/URL formats, etc.).
- FR-12: Data must be validated against the data contract's field types/format (e.g., valid email, valid URL).
- FR-13: Duplicate or near-duplicate records (including fuzzy matches like "OpenAI" vs "Open AI Inc.") must be detected and merged or flagged.
- FR-14: Each final record must carry a confidence indicator reflecting source agreement/quality.

### 5.5 Dataset Management & Dashboard
- FR-15: All datasets must be listed centrally with metadata (name, record count, source count, status, created/updated dates).
- FR-16: Users must be able to search and filter dataset rows by any field.
- FR-17: Users must be able to export a dataset (or filtered subset) as CSV, JSON, and Excel.
- FR-18: Users must be able to inspect the source evidence behind any individual record or field.
- FR-19: Users must be able to view a history of all past workflows/requests, including their status (completed, running, failed) and re-run/duplicate a past workflow.
- FR-20: Users must be able to monitor an active workflow's live progress (stage-by-stage, with counts of records found/valid/duplicate).

### 5.6 Accounts
- FR-21: The system must support authenticated, per-user access so datasets and workflow history are private to their owner (multi-tenant from day one).

## 6. Expected Outputs (Deliverables)

- A working web application (dashboard) where a user can submit a prompt and receive a dataset.
- Persistent storage of: users, workflows, workflow runs/steps, datasets, dataset rows, sources, exports.
- A dataset table export in CSV, JSON, and Excel formats.
- A visible, per-record source trail (which URL(s) produced which field(s)).
- A workflow history view and a live task-monitoring view.

## 7. Non-Functional Requirements

- **Traceability:** No data point should ever exist in a dataset without a recoverable source reference.
- **Resilience:** A single bad/blocked source must never crash an entire workflow run.
- **Transparency:** The user should always be able to tell what stage a running workflow is in and why it's taking time.
- **Extensibility:** New data contract "entity types" (companies, jobs, events, people, products, etc.) should be addable without rewriting the core engine.
- **Auditability:** Every workflow run must be reproducible/inspectable after the fact, not just at run time.

## 8. Out of Scope (v1)

- Scraping sources that require bypassing authentication, paywalls, CAPTCHAs, or explicit robots.txt disallow rules.
- Real-time/streaming datasets that continuously update after initial collection (scheduled re-runs are a stretch goal, not v1).
- Building custom per-client integrations (Salesforce sync, Slack bots, etc.) — export files only in v1.
- Team/role-based collaboration features (sharing datasets between multiple users, permission tiers) — single-owner datasets only in v1.
- Support for non-web data sources (internal databases, uploaded files as the primary input) — the input is always a natural-language prompt targeting the public web.
- Mobile native apps — responsive web only.

## 9. Success Criteria

A user with zero technical background can type one sentence describing a business data need and, within a few minutes, receive a structured, deduplicated, source-cited dataset they can search, filter, and export — without ever configuring a scraper, writing a schema, or touching code.
