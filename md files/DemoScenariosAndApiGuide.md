# AI-Powered Data Intelligence Platform — Demo Scenarios & API Guide

This guide provides everything needed to demonstrate the AI-Powered Data Intelligence Platform to evaluators and judges.

---

## 1. Overview & Demo Configuration

The platform supports both autonomous live web intelligence extraction and deterministic seeded demonstration mode:

| Configuration | Behavior |
|---|---|
| `DEMO_MODE=false` *(default in production)* | Runs real Firecrawl web search/scraping and Gemini LLM structured extraction, normalization, deduplication, and persistence. Requires `GEMINI_API_KEY` and optionally `FIRECRAWL_API_KEY`. |
| `DEMO_MODE=true` | Bypasses external API key assertions. Uses deterministic demo providers and agents. **Every record is explicitly tagged with `_isDemoSimulated: true` and provenance snippets are labeled `[SIMULATED PROVENANCE]`**. Executes identical database schema, quality scoring, deduplication, conflict preservation, and export pipelines. |

### Quick Demo Runner (Terminal)

Run the interactive terminal demonstration showing all 6 stages for any scenario:

```bash
# Run Scenario 1 (100 AI Startups in India)
npm run demo

# Run Scenario 2 (Software Engineering Jobs)
npm run demo -- --scenario 2

# Run Scenario 3 (College Hackathon Sponsors)
npm run demo -- --scenario 3

# Run all 3 scenarios sequentially
npm run demo:all
```

---

## 2. The 3 Polished Demonstration Scenarios

### Scenario 1: Indian AI Startups (Post-2020)
* **User Prompt:** `"Find 100 AI startups in India founded after 2020 with company name, founder, website, funding and location."`
* **Target Count:** 100
* **Discovered Sources:** 19 sources (including 1 broken 404 source to prove run fault tolerance).
* **Records Extracted:** 106 raw records -> 105 valid records.
* **Data Quality:** 3 duplicate startups detected and resolved, 3 cross-source field conflicts preserved.
* **Exports Generated:** CSV (9.3 KB), JSON (18.1 KB), XLSX (11.7 KB).

### Scenario 2: Software Engineering Jobs in India
* **User Prompt:** `"Find software engineering jobs in India and collect company, role, location, salary, application URL and source."`
* **Target Count:** 30
* **Discovered Sources:** 7 sources across LinkedIn, Instahyre, Cutshort, and employer portals (including 1 broken 404 test source).
* **Records Extracted:** 32 raw records -> 32 valid records.
* **Data Quality:** 2 duplicate job postings detected, 2 salary/compensation discrepancies preserved.
* **Exports Generated:** CSV (3.5 KB), JSON (5.9 KB), XLSX (8.5 KB).

### Scenario 3: College Hackathon Technology Sponsors
* **User Prompt:** `"Find potential technology sponsors for a college hackathon and collect company name, industry, website and contact page."`
* **Target Count:** 25
* **Discovered Sources:** 6 sources across Devfolio, MLH, GitHub, and Postman (including 1 broken test source).
* **Records Extracted:** 27 raw records -> 27 valid records.
* **Data Quality:** 2 duplicate sponsor listings detected, 1 industry categorization discrepancy preserved.
* **Exports Generated:** CSV (2.5 KB), JSON (4.1 KB), XLSX (7.8 KB).

---

## 3. End-to-End API Demonstration Walkthrough

All API calls are authenticated using JWT Bearer tokens and workspace isolation headers.

### Step 0: Authentication

#### Register a Demo User
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "judge@hackathon.org",
    "password": "SecurePassword123!",
    "name": "Hackathon Judge"
  }'
```
**Response (201 Created):**
```json
{
  "user": {
    "id": "c1f7b8a0-7612-4c59-a65b-626da4290382",
    "email": "judge@hackathon.org",
    "name": "Hackathon Judge",
    "createdAt": "2026-09-28T10:00:00.000Z"
  },
  "defaultWorkspace": {
    "id": "e4a2d815-9c8e-4a62-8173-9a3d72c1c68e",
    "name": "Hackathon Judge Workspace",
    "role": "OWNER"
  },
  "accessToken": "<JWT_ACCESS_TOKEN>",
  "refreshToken": "<REFRESH_TOKEN>"
}
```

---

### Step 1: Natural Language Requirement Parsing

Transform unstructured user input into a validated, typed data collection specification.

```bash
curl -X POST http://localhost:3000/api/v1/requirements/parse \
  -H "Authorization: Bearer <JWT_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Find 100 AI startups in India founded after 2020 with company name, founder, website, funding and location."
  }'
```

**Response (200 OK):**
```json
{
  "status": "VALID",
  "parsedRequirement": {
    "objective": "Find 100 AI startups in India founded after 2020 with company name, founder, website, funding and location",
    "entityType": "Indian AI Startup",
    "quantity": 100,
    "geography": {
      "places": ["India"],
      "scope": "country",
      "includeSubregions": true
    },
    "timeRange": {
      "field": "founded_year",
      "after": "2020-01-01",
      "before": null,
      "on": null,
      "expression": "founded after 2020"
    },
    "filters": [
      { "field": "founded_year", "operator": "GREATER_THAN", "value": 2020 }
    ],
    "constraints": ["Founded strictly after 2020", "Operating in Artificial Intelligence / Generative AI"],
    "fields": [
      { "key": "company_name", "label": "Company Name", "type": "string", "description": "Startup brand name" },
      { "key": "founder", "label": "Founder(s)", "type": "string", "description": "Founders or executive team" },
      { "key": "website", "label": "Website", "type": "url", "description": "Official company URL" },
      { "key": "funding", "label": "Funding Stage", "type": "string", "description": "Venture round" },
      { "key": "location", "label": "Location", "type": "string", "description": "Headquarters city in India" }
    ],
    "requiredFields": ["company_name", "founder", "website", "funding", "location"],
    "optionalFields": [],
    "sourcePreferences": ["Tracxn", "Inc42", "YourStory", "Official Company Domains"],
    "sourceRestrictions": [],
    "deduplicationKeys": ["company_name"],
    "validationRules": [
      { "fieldKey": "company_name", "rule": "REQUIRED", "description": "Company name is mandatory", "severity": "error" },
      { "fieldKey": "website", "rule": "URL", "description": "Website must be a valid URL", "severity": "error" }
    ],
    "outputFormat": "json"
  },
  "feedback": "Requirement successfully parsed and structured for autonomous workflow planning."
}
```

---

### Step 2: Autonomous Workflow Plan Generation

Synthesize an executable Directed Acyclic Graph (DAG) with retry policies, rate limits, and deduplication rules.

```bash
curl -X POST http://localhost:3000/api/v1/workflows/plan \
  -H "Authorization: Bearer <JWT_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "e4a2d815-9c8e-4a62-8173-9a3d72c1c68e",
    "requirement": { ... },
    "originalPrompt": "Find 100 AI startups in India founded after 2020 with company name, founder, website, funding and location."
  }'
```

**Response (200 OK):**
```json
{
  "plan": {
    "version": 1,
    "objective": "Collect 100 Indian AI startups founded after 2020 with founders, funding rounds, and verified URLs",
    "constraints": ["Founded strictly after 2020", "Operating in AI/GenAI domain"],
    "sourcePolicy": {
      "permittedSourceTypes": ["official_website", "business_directory", "news"],
      "allowedDomains": [],
      "preferredDomains": ["tracxn.com", "inc42.com", "yourstory.com"],
      "blockedDomains": ["spam-directory.com"],
      "respectRobotsTxt": true,
      "maxRequestsPerDomainPerMinute": 30
    },
    "searchStrategy": {
      "queries": [
        { "query": "top Indian generative AI startups founded after 2020 directory", "sourceType": "business_directory" },
        { "query": "Indian AI startups funding rounds 2023 2024", "sourceType": "news" }
      ],
      "desiredSourceCount": 20
    },
    "steps": [
      { "id": "search-ai-startups", "type": "SEARCH", "dependencies": [], "description": "Discover candidate Indian AI startup directories" },
      { "id": "scrape-ai-startups", "type": "SCRAPE", "dependencies": ["search-ai-startups"], "description": "Scrape company details and funding" },
      { "id": "extract-ai-startups", "type": "EXTRACT", "dependencies": ["scrape-ai-startups"], "description": "Extract structured company records" },
      { "id": "transform-ai-startups", "type": "TRANSFORM", "dependencies": ["extract-ai-startups"], "description": "Normalize names, URLs, and funding" },
      { "id": "validate-ai-startups", "type": "VALIDATE", "dependencies": ["transform-ai-startups"], "description": "Apply domain validation rules" },
      { "id": "dedupe-ai-startups", "type": "DEDUPLICATE", "dependencies": ["validate-ai-startups"], "description": "Deduplicate identical startups & record conflicts" },
      { "id": "save-ai-startups", "type": "SAVE", "dependencies": ["dedupe-ai-startups"], "description": "Persist dataset, columns, rows, and source evidence" }
    ],
    "completionCriteria": {
      "targetRecordCount": 100,
      "minimumSources": 10,
      "requireSourceEvidence": true
    }
  }
}
```

---

### Step 3: Workflow Execution & Live SSE Monitoring

#### Trigger Execution
```bash
curl -X POST http://localhost:3000/api/v1/workflows/execute \
  -H "Authorization: Bearer <JWT_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "e4a2d815-9c8e-4a62-8173-9a3d72c1c68e",
    "prompt": "Find 100 AI startups in India founded after 2020 with company name, founder, website, funding and location."
  }'
```
**Response (202 Accepted):**
```json
{
  "workflowId": "65b827e8-469b-4395-813d-51f7bb980f12",
  "runId": "48de27ca-f033-4f93-bc4e-1b3fe940f811",
  "status": "PENDING"
}
```

#### Connect to Live Server-Sent Events (SSE)
```bash
curl -N http://localhost:3000/api/v1/runs/48de27ca-f033-4f93-bc4e-1b3fe940f811/events \
  -H "Authorization: Bearer <JWT_ACCESS_TOKEN>"
```
**Live Event Stream Output:**
```
event: activity
data: {"action":"SOURCE_DISCOVERY_STARTED","timestamp":"2026-09-28T10:01:00.000Z"}

event: activity
data: {"action":"SOURCE_DISCOVERED","details":{"url":"https://sarvam.ai","domain":"sarvam.ai"},"timestamp":"2026-09-28T10:01:01.000Z"}

event: activity
data: {"action":"SCRAPE_STARTED","timestamp":"2026-09-28T10:01:02.000Z"}

event: activity
data: {"action":"EXTRACTION_STARTED","timestamp":"2026-09-28T10:01:03.000Z"}

event: activity
data: {"action":"RECORDS_EXTRACTED","details":{"count":106},"timestamp":"2026-09-28T10:01:04.000Z"}

event: activity
data: {"action":"VALIDATION_COMPLETED","details":{"validCount":105},"timestamp":"2026-09-28T10:01:05.000Z"}

event: activity
data: {"action":"DEDUPLICATION_COMPLETED","details":{"duplicates":3,"conflicts":3},"timestamp":"2026-09-28T10:01:06.000Z"}

event: activity
data: {"action":"DATASET_CREATED","details":{"datasetId":"0f0e81b9-c45b-46f7-967b-7e0d9265f378"},"timestamp":"2026-09-28T10:01:07.000Z"}

event: activity
data: {"action":"RUN_COMPLETED","timestamp":"2026-09-28T10:01:08.000Z"}
```

---

### Step 4: Inspect Run Metrics & Data Quality

```bash
curl -X GET http://localhost:3000/api/v1/runs/48de27ca-f033-4f93-bc4e-1b3fe940f811 \
  -H "Authorization: Bearer <JWT_ACCESS_TOKEN>"
```
**Response (200 OK):**
```json
{
  "id": "48de27ca-f033-4f93-bc4e-1b3fe940f811",
  "status": "COMPLETED",
  "startedAt": "2026-09-28T10:01:00.000Z",
  "completedAt": "2026-09-28T10:01:08.000Z",
  "durationMs": 8000,
  "recordsFound": 106,
  "recordsAccepted": 102,
  "duplicatesCount": 3,
  "failedSourcesCount": 1,
  "sourceCount": 19,
  "datasetId": "0f0e81b9-c45b-46f7-967b-7e0d9265f378"
}
```

---

### Step 5: Explore Dataset, Rows & Source Evidence

#### Get Dataset Metadata
```bash
curl -X GET http://localhost:3000/api/v1/datasets/0f0e81b9-c45b-46f7-967b-7e0d9265f378 \
  -H "Authorization: Bearer <JWT_ACCESS_TOKEN>"
```

#### Query Rows with Pagination & Deduplication Filtering
```bash
curl -X GET "http://localhost:3000/api/v1/datasets/0f0e81b9-c45b-46f7-967b-7e0d9265f378/rows?page=1&limit=5&includeDuplicates=false" \
  -H "Authorization: Bearer <JWT_ACCESS_TOKEN>"
```
**Response (200 OK):**
```json
{
  "data": [
    {
      "id": "52062590-7c2c-4735-8ea7-a369e5d4cb04",
      "rowNumber": 1,
      "values": {
        "company_name": "Sarvam AI",
        "founder": "Vivek Raghavan, Pratyush Kumar",
        "website": "https://sarvam.ai/",
        "funding": "Series A",
        "location": "Bengaluru",
        "_isDemoSimulated": true
      },
      "isValid": true,
      "isDuplicate": false,
      "verificationStatus": "VERIFIED",
      "confidenceScore": 0.95,
      "sourceUrls": ["https://sarvam.ai", "https://tracxn.com/explore/Artificial-Intelligence-Startups-in-India"],
      "conflicts": [
        {
          "fieldKey": "funding",
          "canonicalValue": "Series A",
          "alternateValue": "Seed",
          "canonicalSourceUrls": ["https://sarvam.ai"],
          "alternateSourceUrls": ["https://inc42.com/reports/indian-ai-startups-2024"]
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 5,
    "total": 102,
    "totalPages": 21
  }
}
```

#### Inspect Discovered Sources & Provenance
```bash
curl -X GET "http://localhost:3000/api/v1/datasets/0f0e81b9-c45b-46f7-967b-7e0d9265f378/sources" \
  -H "Authorization: Bearer <JWT_ACCESS_TOKEN>"
```

---

### Step 6: Multi-Format Data Export (CSV, JSON, XLSX)

#### Trigger CSV Export
```bash
curl -X POST http://localhost:3000/api/v1/datasets/0f0e81b9-c45b-46f7-967b-7e0d9265f378/exports \
  -H "Authorization: Bearer <JWT_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "CSV"
  }'
```
**Response (201 Created):**
```json
{
  "id": "f58f0c5b-30bd-474c-ba53-6239bc7a493a",
  "datasetId": "0f0e81b9-c45b-46f7-967b-7e0d9265f378",
  "format": "CSV",
  "status": "COMPLETED",
  "fileMetadata": {
    "fileName": "dataset-collect-100-indian-ai--2b982bc8.csv",
    "mimeType": "text/csv",
    "sizeBytes": 9523,
    "rowCount": 102
  }
}
```

#### Trigger XLSX Spreadsheet Export
```bash
curl -X POST http://localhost:3000/api/v1/datasets/0f0e81b9-c45b-46f7-967b-7e0d9265f378/exports \
  -H "Authorization: Bearer <JWT_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "XLSX"
  }'
```

#### Download Export File
```bash
curl -X GET http://localhost:3000/api/v1/exports/f58f0c5b-30bd-474c-ba53-6239bc7a493a/download \
  -H "Authorization: Bearer <JWT_ACCESS_TOKEN>" \
  -o dataset-export.csv
```
