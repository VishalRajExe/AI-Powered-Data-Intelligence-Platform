# PirateAgent (Scoutly) — AI-Powered Data Intelligence Platform

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js-14.2-black?logo=next.js&logoColor=white)](https://nextjs.org)
[![MySQL](https://img.shields.io/badge/MySQL-8.0-4479A1?logo=mysql&logoColor=white)](https://www.mysql.com)
[![Redis](https://img.shields.io/badge/Redis-BullMQ-DC382D?logo=redis&logoColor=white)](https://redis.io)
[![Prisma](https://img.shields.io/badge/Prisma-6.12-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io)
[![Tests](https://img.shields.io/badge/Tests-213%20Passed-brightgreen)](https://github.com/VishalRajExe/AI-Powered-Data-Intelligence-Platform)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**PirateAgent** is a production-grade, autonomous web research and data intelligence platform. Give it a natural-language prompt in plain English, and your AI Data Crew parses requirements into strict data contracts, synthesizes execution DAGs, navigates permitted web sources, extracts structured records, runs an automated quality/deduplication pipeline, and persists clean datasets in MySQL with granular evidence provenance and multi-format exports.

---

## Table of Contents

- [System Architecture](#system-architecture)
- [End-to-End Workflow Flowchart](#end-to-end-workflow-flowchart)
- [Data Intelligence & Governance Pipeline](#data-intelligence--governance-pipeline)
- [Database Schema (ERD)](#database-schema-erd)
- [Core Features](#core-features)
- [Technology Stack](#technology-stack)
- [Repository Structure](#repository-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Quick Start with Docker](#quick-start-with-docker)
  - [Local Development Setup](#local-development-setup)
- [Live Demonstration Scenarios](#live-demonstration-scenarios)
- [API Documentation](#api-documentation)
- [Security & Production Hardening](#security--production-hardening)
- [Testing & Quality Assurance](#testing--quality-assurance)
- [License](#license)

---

## System Architecture

```mermaid
flowchart TB
    subgraph Frontend["PirateAgentUI (Next.js 14 / TailwindCSS / Radix)"]
        UI_Home["Landing Page (/)"]
        UI_Dash["Dashboard (/dashboard)"]
        UI_New["New Research (/dashboard/research/new)"]
        UI_Live["Live Run (/dashboard/workflows/live)"]
        UI_Workflows["Workflows (/dashboard/workflows)"]
        UI_Datasets["Datasets & Evidence (/dashboard/datasets)"]
        UI_Sources["Sources & Governance (/dashboard/sources)"]
        UI_Exports["Multi-Format Export Menu"]
        UI_Auth["Auth State / JWT Session"]
    end

    subgraph API_Gateway["Backend API Gateway (Express 5 / TypeScript)"]
        Auth_Middleware["JWT Auth & Workspace Guard"]
        Rate_Limiter["Rate Limiting & Helmet"]
        Router_Auth["/api/v1/auth/*"]
        Router_Req["/api/v1/requirements/parse"]
        Router_WF["/api/v1/workflows/*"]
        Router_Runs["/api/v1/runs/* (SSE Events)"]
        Router_DS["/api/v1/datasets/*"]
        Router_Exp["/api/v1/exports/*"]
    end

    subgraph Orchestration["Autonomous Orchestration Engine"]
        ReqParser["RequirementParserService\n(LLM Data Contract Synthesis)"]
        Planner["WorkflowPlannerService\n(Deterministic DAG Generator)"]
        Queue["BullMQ Queue & Redis Broker"]
        Runner["WorkflowRunner Worker"]
    end

    subgraph Web_Agent["Agent Execution & Source Governance"]
        AgentCore["@aidp/firecrawl-agent-core\n(Deep Agents Framework)"]
        Adapter["FirecrawlAgentAdapter\n(Search / Scrape / Interact)"]
        RelevantSelector["RelevantSourceSelector\n(Relevance Scoring & Token Filter)"]
        SourcePolicy["SourcePolicyService\n(Robots.txt + SSRF Protection + RateLimit)"]
        DemoAdapter["DemoAgentAdapter\n(Deterministic Seed Mode)"]
    end

    subgraph Pipeline["Data Intelligence Engine"]
        Normalizer["NormalizationService\n(URLs, Dates, Phones, Currency)"]
        Validator["ValidationService\n(Zod Schema & Format Guard)"]
        Deduplicator["DeduplicationService\n(Exact & Normalized Fuzzy Match)"]
        ConflictEngine["EntityResolution & Conflict Tracking"]
        QualityScorer["DataQualityService\n(Confidence & Integrity Score)"]
    end

    subgraph Persistence["Storage & Persistence Layer"]
        MySQL[("MySQL 8.0\n(Prisma ORM)")]
        RedisDB[("Redis 7.0\n(Queues, Locks, Pub/Sub)")]
    end

    Frontend -- "HTTP REST + JWT" --> API_Gateway
    Frontend -- "EventSource (SSE Stream)" --> Router_Runs
    API_Gateway --> Auth_Middleware
    Auth_Middleware --> Router_Req & Router_WF & Router_DS & Router_Exp

    Router_Req --> ReqParser
    Router_WF --> Planner --> Queue --> Runner
    Runner --> Adapter & DemoAdapter
    Adapter --> SourcePolicy --> RelevantSelector --> AgentCore

    AgentCore --> Normalizer --> Validator --> Deduplicator --> ConflictEngine --> QualityScorer
    QualityScorer --> MySQL
    Runner -- "Pub/Sub Progress" --> RedisDB --> Router_Runs
    Router_DS & Router_Exp --> MySQL
```

---

## End-to-End Workflow Flowchart

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Researcher
    participant UI as PirateAgentUI
    participant API as Backend API
    participant LLM as AI LLM Provider
    participant Queue as BullMQ (Redis)
    participant Runner as WorkflowRunner
    participant Agent as Firecrawl Agent Core
    participant Gov as Source Policy & SSRF
    participant DataEng as Data Intelligence Pipeline
    participant DB as MySQL Database

    User->>UI: Enters Natural Language Prompt
    UI->>API: POST /api/v1/requirements/parse
    API->>LLM: Analyze Prompt & Extract Contract
    LLM-->>API: Data Contract (Entity, Fields, Filters, Target Count)
    API-->>UI: Return Data Contract & Preview Schema
    UI->>User: Renders Editable Contract & DAG Plan

    User->>UI: Confirms & Clicks "Set Sail"
    UI->>API: POST /api/v1/workflows/execute
    API->>Queue: Enqueue Workflow Job
    API-->>UI: Return workflowId & runId
    UI->>UI: Redirects to /dashboard/workflows/live?runId=...
    UI->>API: GET /api/v1/runs/:id/events (Connect SSE)

    Queue->>Runner: Pick up Workflow Job
    Runner->>API: Emit RUN_STARTED via SSE
    API-->>UI: Stream: Stage "Understand" Active

    Runner->>Agent: Step: SEARCH
    Agent->>Gov: Validate URLs & Check Robots.txt / SSRF
    Gov-->>Agent: Approved URLs
    Agent-->>Runner: Discovered Sources List
    Runner->>API: Emit SOURCE_DISCOVERED via SSE

    Runner->>Agent: Step: SCRAPE & EXTRACT
    Agent->>LLM: Structured Extraction per Data Contract
    LLM-->>Agent: Raw Extracted JSON Records
    Runner->>API: Emit RECORDS_EXTRACTED via SSE

    Runner->>DataEng: Step: TRANSFORM, VALIDATE, DEDUPLICATE
    DataEng->>DataEng: Normalize Casing, URLs, Dates
    DataEng->>DataEng: Validate Schema Types & Required Fields
    DataEng->>DataEng: Deduplicate & Flag Conflicts
    DataEng->>DataEng: Calculate Confidence Scores

    DataEng->>DB: Persist Dataset, DatasetRows, Sources, Evidence
    Runner->>API: Emit RUN_COMPLETED via SSE
    API-->>UI: Stream: Stage "Build" Complete → Link to Dataset
    UI->>User: Displays Completed Dataset with Quality Score
```

---

## Data Intelligence & Governance Pipeline

Every extracted record passes through a multi-stage validation, cleaning, and provenance pipeline before persistence:

```mermaid
flowchart LR
    subgraph Governance["1. Source Governance"]
        URL_In["Discovered URL"] --> SSRF["SSRF Validator\n(Blocks Private IPs / AWS Metadata)"]
        SSRF --> Robots["RobotsPolicyService\n(User-Agent & Path Gate)"]
        Robots --> RateLimit["RateLimitService\n(Domain Concurrency Caps)"]
        RateLimit --> SafeURL["Approved Target"]
    end

    subgraph Cleaning["2. Intelligence Pipeline"]
        SafeURL --> Extract["Raw Record Extraction"]
        Extract --> Norm["NormalizationService\n• Canonical URLs\n• Standard Dates (ISO)\n• E.164 Phones\n• Numeric Currency"]
        Norm --> Val["ValidationService\n• Type checking (Zod)\n• Required field checks\n• Format validation"]
        Val --> Dedup["DeduplicationService\n• Exact hash matching\n• Normalized URL match\n• Soft entity resolution"]
        Dedup --> Conflict["Conflict Tracking\n(Preserves conflicting source values)"]
    end

    subgraph Storage["3. Provenance Storage"]
        Conflict --> Row["DatasetRow"]
        Conflict --> Evidence["SourceEvidence\n• Source URL\n• Text Snippet\n• Confidence Score\n• Retrieved Timestamp"]
    end
```

---

## Database Schema (ERD)

```mermaid
erDiagram
    Workspace ||--o{ User : "contains"
    Workspace ||--o{ Workflow : "owns"
    Workspace ||--o{ Dataset : "owns"
    User ||--o{ Workflow : "creates"
    
    Workflow ||--o{ WorkflowRun : "executes"
    Workflow ||--o{ WorkflowStep : "defines"
    Workflow ||--o{ WorkflowSource : "queries"

    WorkflowRun ||--o{ ActivityEvent : "logs"
    WorkflowRun ||--o{ Dataset : "produces"

    Dataset ||--o{ DatasetColumn : "has schema"
    Dataset ||--o{ DatasetRow : "contains"
    Dataset ||--o{ ExportJob : "exports"

    DatasetRow ||--o{ SourceEvidence : "backed by"

    Workspace {
        string id PK
        string name
        string slug
        datetime createdAt
    }

    User {
        string id PK
        string email
        string passwordHash
        string name
        string role
        string workspaceId FK
    }

    Workflow {
        string id PK
        string name
        string prompt
        string status
        json dataContract
        json planDag
        string workspaceId FK
    }

    WorkflowRun {
        string id PK
        string workflowId FK
        string status
        int progress
        int recordsFound
        int validRecords
        int duplicates
        int durationMs
    }

    Dataset {
        string id PK
        string name
        int totalRecords
        int validRecords
        float qualityScore
        string workflowRunId FK
    }

    DatasetRow {
        string id PK
        string datasetId FK
        json values
        json rawValues
        boolean isValid
        float confidenceScore
        json conflicts
    }

    SourceEvidence {
        string id PK
        string datasetRowId FK
        string fieldName
        string sourceUrl
        string snippet
        float confidence
        datetime retrievedAt
    }
```

---

## Core Features

### 1. Natural Language Requirement Parsing
- Accepts arbitrary queries (e.g., *"Find 100 AI startups in India founded after 2020 with founder and funding"*).
- Uses strict LLM system prompts to synthesize a structured **Data Contract** specifying entity name, target record count, required and optional fields, and filtering rules.

### 2. Autonomous DAG Workflow Planner
- Generates a versioned directed acyclic graph (DAG) of discrete execution steps: `SEARCH` → `SCRAPE` → `EXTRACT` → `TRANSFORM` → `VALIDATE` → `DEDUPLICATE` → `SAVE`.
- Includes plan self-correction and validation logic to guarantee safe execution.

### 3. Deep Agent Web Collection (`@aidp/firecrawl-agent-core`)
- Fully integrated first-party agent core wrapping Firecrawl's Deep Agent toolkit.
- Supports search, page scraping, and page interaction with adaptive subagent coordination.

### 4. Source Governance & SSRF Defense
- **Private IP & Loopback Blocking**: Automatically checks DNS resolution before making outbound HTTP calls; blocks `127.0.0.1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254` (cloud metadata endpoints), and internal domain names.
- **Robots.txt Compliance**: Checks `robots.txt` disallow rules per domain with configurable timeouts and bot user-agent.
- **Rate-Limiting**: Domain-level concurrency throttling via Redis sliding window counters.
- **Exponential Backoff**: Configurable retries on transient network failures and 429/503 HTTP status codes.

### 5. Data Intelligence & Deduplication
- **Multi-Level Normalization**: Dates converted to ISO-8601, URLs normalized (trailing slashes, UTM parameter stripping), phone numbers converted to E.164, and monetary values parsed to numeric amounts and currencies.
- **Fuzzy & Exact Deduplication**: Eliminates duplicates across multiple sources while preserving conflicting field values in a transparent `conflicts` JSON attribute.
- **Explainable Quality Scoring**: Calculates a composite dataset quality score based on completeness, validation pass rate, and confidence scores.

### 6. Real-Time SSE Task Monitoring
- Native Server-Sent Events (`GET /api/v1/runs/:id/events`) with historical event replay upon connection.
- Streams live progress percentages, step state transitions, discovered source counts, record counters, and agent terminal logs.

### 7. Interactive Explorer & Evidence Drawer
- Tabular data viewer with server-side pagination, sorting, and full-text search.
- **Inspect Evidence Drawer**: Clicking any row reveals the exact source URL, publication timestamp, and extracted text snippet backing that specific record.

### 8. Multi-Format Export Engine
- Background export service generating **CSV**, **JSON**, and native **Excel (.xlsx)** workbooks with formatted headers.

### 9. Deterministic Judge Demo Mode (`DEMO_MODE=true`)
- Built-in zero-cost deterministic demonstration mode for hackathon judges and evaluators.
- Pre-seeded with 3 realistic scenarios that execute the entire validation, deduplication, MySQL persistence, and export pipeline without requiring external API keys.

---

## Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend UI** | Next.js 14.2 (App Router), React 18, TailwindCSS 3.4, Framer Motion 11, Radix UI Primitives, Lucide Icons |
| **Backend API** | Node.js 20+ (ES Modules), Express 5, TypeScript 5.9, Zod 3.25, Pino Logger, Helmet, CORS |
| **Agent Framework** | `@aidp/firecrawl-agent-core` (vendored Deep Agents core), Firecrawl SDK |
| **LLM Providers** | Google Gemini (`gemini-2.5-flash`), Anthropic Claude, OpenAI (configurable) |
| **Task Queue** | BullMQ 6.3, Redis 7 (Distributed locking, sliding-window rate limiting, Pub/Sub) |
| **Database & ORM** | MySQL 8.0, Prisma ORM 6.12 |
| **File Exports** | ExcelJS (XLSX), Fast-CSV |
| **Testing** | Vitest 4, Supertest 7, TypeScript Strict Typechecking |
| **Infrastructure** | Docker, Docker Compose |

---

## Repository Structure

```
├── PirateAgentUI/                 # Next.js 14 Frontend Application
│   ├── app/                       # App Router routes
│   │   ├── (auth)/                # Login & Signup authentication routes
│   │   ├── dashboard/             # Platform dashboard routes
│   │   │   ├── activity/          # Chronological execution activity feed
│   │   │   ├── datasets/          # Dataset explorer & evidence drawer
│   │   │   ├── history/           # Workflow mission history
│   │   │   ├── research/new/      # Requirement parsing & plan preview
│   │   │   ├── settings/          # User profile & theme settings
│   │   │   ├── sources/           # Visited sources & governance catalog
│   │   │   └── workflows/         # Workflow catalog & live SSE monitor
│   │   ├── globals.css            # Tailwind design tokens & themes
│   │   ├── layout.tsx             # Root application layout
│   │   └── page.tsx               # Animated PirateAgent landing page
│   ├── components/                # Reusable UI components
│   │   ├── common/                # Logo, StatusBadge, EmptyState
│   │   ├── dashboard/             # StatCard, PromptBox, RecentWidgets
│   │   ├── dataset/               # DataTable, EvidenceDrawer, ExportMenu
│   │   ├── layout/                # Sidebar, Topbar
│   │   ├── research/              # PlanPreview DAG component
│   │   ├── ui/                    # Radix UI wrappers (Button, Card, Input...)
│   │   └── workflow/              # WorkflowRunView, LiveStats, Terminal
│   ├── hooks/                     # Custom React hooks (useApi, useSSE, useCountUp)
│   ├── lib/                       # API client (api.ts), AuthContext (auth.tsx), types
│   └── next.config.js             # API proxy rewrites to backend
│
├── backend/                       # Node.js / Express Backend Service
│   ├── prisma/                    # Prisma database schema & seed scripts
│   ├── src/
│   │   ├── agent/                 # FirecrawlAgentAdapter & result normalizers
│   │   ├── config/                # Environment schema (Zod)
│   │   ├── db/                    # Prisma client & repository layer
│   │   ├── docs/                  # OpenAPI 3.1.0 specifications
│   │   ├── middleware/            # Auth guard, error handler, rate limits
│   │   ├── modules/
│   │   │   ├── auth/              # JWT TokenService & AuthService
│   │   │   ├── data-intelligence/ # Normalization, Validation, Deduplication
│   │   │   ├── demo/              # Deterministic demo providers & datasets
│   │   │   ├── export/            # CSV, JSON, XLSX export generators
│   │   │   ├── monitoring/        # Redis Pub/Sub & SSE EventBroadcaster
│   │   │   ├── planner/           # WorkflowPlannerService & DAG synthesis
│   │   │   ├── requirements/      # RequirementParserService (LLM parsing)
│   │   │   ├── sources/           # SourcePolicy, Robots, SSRF, RateLimits
│   │   │   └── workflows/         # WorkflowExecutionService & WorkflowRunner
│   │   ├── queue/                 # BullMQ queue & worker configuration
│   │   ├── routes/                # Express API routes (/api/v1/*)
│   │   ├── scripts/               # CLI demo runner (run-demo.ts)
│   │   └── server.ts              # HTTP & WebSocket/SSE server startup
│   └── tests/                     # 213 unit, integration, and E2E tests
│
├── packages/
│   └── firecrawl-agent-core/      # Vendored Deep Agents research framework
│
├── md files/                      # Project architectural documentation & contracts
│   ├── Architecture.md            # Complete system design & data model
│   ├── DemoScenariosAndApiGuide.md # Evaluator guide & curl examples
│   ├── Memory.md                  # Detailed phase progression & audit log
│   ├── Phases.md                  # Development phases & completion criteria
│   └── PRD.md                     # Product Requirements Document
│
├── docker-compose.yml             # Local MySQL + Redis + Backend stack
├── Dockerfile                     # Multi-stage production container build
├── package.json                   # Root npm workspaces configuration
└── README.md                      # Project documentation
```

---

## Getting Started

### Prerequisites
- **Node.js**: `v20.0.0` or higher
- **npm**: `v10.0.0` or higher
- **Docker & Docker Compose** (optional for containerized setup)
- **MySQL 8.0+** & **Redis 7.0+** (if running locally without Docker)

---

### Quick Start with Docker

The fastest way to spin up the backend, database, and Redis queue:

```bash
# 1. Clone repository
git clone https://github.com/VishalRajExe/AI-Powered-Data-Intelligence-Platform.git
cd AI-Powered-Data-Intelligence-Platform

# 2. Configure environment
cp .env.example .env

# 3. Start MySQL, Redis, and Backend
docker-compose up -d

# 4. Start the Frontend UI
npm install
npm run dev:frontend
```

Open **`http://localhost:3000`** in your browser to start using PirateAgent.

---

### Local Development Setup

#### 1. Install Dependencies
Install dependencies across all workspaces:
```bash
npm install
```

#### 2. Configure Environment Variables
Create `.env` in the root directory:
```env
APP_ENV=development
PORT=4000
FRONTEND_ORIGIN=http://localhost:3000
LOG_LEVEL=info

# Database (MySQL)
DATABASE_URL=mysql://aidp:development-password@localhost:3306/aidp_dev
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=aidp
MYSQL_PASSWORD=development-password
MYSQL_DATABASE=aidp_dev

# Queue (Redis)
REDIS_URL=redis://127.0.0.1:6379

# JWT Authentication
JWT_ACCESS_SECRET=development_access_secret_key_minimum_32_characters_long!
JWT_REFRESH_SECRET=development_refresh_secret_key_minimum_32_characters_long!

# LLM & Web Scraping (Optional: defaults to DEMO_MODE if omitted)
FIRECRAWL_API_KEY=
GEMINI_API_KEY=
LLM_PROVIDER=google
LLM_MODEL_ID=gemini-2.5-flash

# Set to true for offline judge demonstration
DEMO_MODE=true
```

#### 3. Run Database Migrations
```bash
# Generate Prisma Client & apply migrations
npm run db:generate
npm run db:migrate
npm run db:seed
```

#### 4. Start Services
In separate terminal windows:

**Terminal 1 (Backend API & Worker):**
```bash
npm run dev
# Starts backend server on http://localhost:4000
```

**Terminal 2 (PirateAgentUI Frontend):**
```bash
npm run dev:frontend
# Starts Next.js app on http://localhost:3000
```

Open **`http://localhost:3000`** and log in with the seeded credentials:
- **Email:** `demo@pirateagent.ai`
- **Password:** `Demo1234!`

---

## Live Demonstration Scenarios

For evaluations and presentations, the platform includes 3 demonstration scenarios accessible via the web UI or the interactive terminal CLI.

### Run the Interactive Terminal Demo
```bash
# Run Scenario 1 (Startups)
npm run demo

# Run all 3 Scenarios sequentially
npm run demo:all
```

### Scenario Overview

| Scenario | Objective | Target Count | Validation & Metrics Verified |
| :--- | :--- | :---: | :--- |
| **Scenario 1** | *"Find 100 AI startups in India founded after 2020 with company name, founder, website, funding and location."* | 100 records | 106 extracted, 105 valid, 3 duplicates merged, 3 funding conflicts preserved, 19 sources queried (1 broken 404 test source handled gracefully). |
| **Scenario 2** | *"Find software engineering jobs in India and collect company, role, location, salary, application URL and source."* | 30 records | 32 extracted, 30 valid, 2 duplicates merged, 2 salary conflicts preserved, 7 sources queried. |
| **Scenario 3** | *"Find potential technology sponsors for a college hackathon and collect company name, industry, website and contact page."* | 25 records | 27 extracted, 25 valid, 2 duplicates merged, 1 contact conflict preserved, 6 sources queried. |

---

## API Documentation

The backend serves an interactive, machine-readable **OpenAPI 3.1.0** specification at:
```
GET http://localhost:4000/api/v1/openapi.json
```

### Core API Endpoints

| Category | Method | Endpoint | Description |
| :--- | :---: | :--- | :--- |
| **Auth** | `POST` | `/api/v1/auth/register` | Register a new account & create workspace |
| | `POST` | `/api/v1/auth/login` | Authenticate & receive access/refresh tokens |
| | `POST` | `/api/v1/auth/refresh` | Refresh expired access token |
| | `GET` | `/api/v1/auth/me` | Fetch authenticated user profile & workspace |
| **Planning** | `POST` | `/api/v1/requirements/parse` | Parse natural language prompt into Data Contract |
| | `POST` | `/api/v1/workflows/plan` | Generate validated DAG execution plan |
| **Execution** | `POST` | `/api/v1/workflows/execute` | Dispatch execution plan to BullMQ queue |
| | `GET` | `/api/v1/workflows` | List workflows in workspace |
| | `GET` | `/api/v1/workflows/:id` | Get workflow details & DAG structure |
| | `GET` | `/api/v1/runs/:id` | Get status and progress metrics of a run |
| | `GET` | `/api/v1/runs/:id/events` | **Server-Sent Events (SSE)** real-time execution stream |
| | `GET` | `/api/v1/runs/:id/activity` | Chronological activity event feed |
| **Datasets** | `GET` | `/api/v1/datasets` | List completed datasets |
| | `GET` | `/api/v1/datasets/:id` | Get dataset metadata & column schema |
| | `GET` | `/api/v1/datasets/:id/rows` | Query dataset rows with search, sort, pagination |
| | `GET` | `/api/v1/datasets/:id/sources`| Get all sources visited for a dataset |
| | `GET` | `/api/v1/datasets/:id/rows/:rowId/evidence` | Get granular snippet evidence backing a row |
| **Exports** | `POST` | `/api/v1/datasets/:id/exports` | Trigger export job (CSV, JSON, XLSX) |
| | `GET` | `/api/v1/exports/:id/download` | Download generated export file |

---

## Security & Production Hardening

- **SSRF (Server-Side Request Forgery) Defense**: All outbound requests validate destination hosts against non-routable CIDR blocks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.169.254`). Pre-flight DNS resolution detects and rejects internal infrastructure rebinding attempts.
- **Strict Tenant Isolation**: All queries enforce tenant isolation using the authenticated user's `workspaceId`. Cross-workspace data access returns a 403 Forbidden.
- **SQL Injection Prevention**: All database queries are executed via Prisma ORM parameterized statements; raw SQL is restricted to parameter-bound health probes.
- **Safe HTML & Data Ingestion**: All scraped text content is stripped of executable script elements and sanitized before structured parsing.
- **Timing-Safe Password Verification**: Password hashing uses `bcryptjs` with standard salt rounds.

---

## Testing & Quality Assurance

The codebase maintains automated test coverage across all pipeline stages:

```bash
# Run all backend unit, integration, and E2E test suites
npm run test

# Run TypeScript typechecking across all workspaces
npm run typecheck

# Run ESLint linter on backend and frontend
npm run lint
npm run lint:frontend

# Build backend and frontend for production
npm run build
npm run build:frontend
```

### Verified Test Results
```
 Test Files  18 passed | 2 skipped (20)
      Tests  213 passed | 8 skipped (221)
   Duration  4.34s
```

All 213 unit and integration tests pass cleanly with 0 failures, 0 TypeScript errors (`tsc --noEmit`), and 0 ESLint warnings.

---

## License

This project is licensed under the [MIT License](LICENSE).
Vendored subcomponents from `@aidp/firecrawl-agent-core` preserve their original MIT license declarations in `packages/firecrawl-agent-core/UPSTREAM.md`.
