/**
 * Phase 10 — Source and Evidence Explorer Tests
 *
 * Tests cover:
 *  - GET /api/v1/rows/:id/evidence  (row evidence explorer)
 *  - Field-level provenance: multi-source fields (Company: Acme AI from Source A, Founder: John Doe from Source B)
 *  - Distinct DatasetRowSource mapping with supportedFields
 *  - Verification logic: unrelated snippet content is not claimed as verified
 *  - Conflict preservation: different sources disagreeing on field values
 *  - GET /api/v1/datasets/:id/sources (preserves URL, domain, page title, retrievedAt, source type, workflow run, extraction step, evidence snippet, source status)
 *  - GET /api/v1/sources/:id (single source inspection with full evidence and metadata)
 *  - Workspace access control (403) and 404 handling
 */

import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import pino from "pino";
import { DatasetQueryRepository } from "../src/db/repositories/dataset-query.repository.js";
import { createDatasetsRouter } from "../src/routes/datasets.routes.js";
import { createErrorHandler } from "../src/common/errors.js";
import {
  isSnippetVerifyingValue,
  buildRowEvidenceExplorer,
} from "../src/modules/evidence/index.js";
import type { PrismaClient } from "@prisma/client";

const WS = "00000000-0000-0000-0000-000000000001";
const USER = "00000000-0000-0000-0000-000000000002";
const DS = "00000000-0000-0000-0000-000000000003";
const ROW = "00000000-0000-0000-0000-000000000004";
const SRC_A = "00000000-0000-0000-0000-00000000000a";
const SRC_B = "00000000-0000-0000-0000-00000000000b";

type MockPrisma = {
  workspaceMember: { findUnique: ReturnType<typeof vi.fn> };
  dataset: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  datasetRow: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  source: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
};

function makePrisma(overrides: Partial<MockPrisma> = {}): PrismaClient {
  return {
    workspaceMember: {
      findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE" }),
      ...overrides.workspaceMember,
    },
    dataset: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides.dataset,
    },
    datasetRow: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides.datasetRow,
    },
    source: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides.source,
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as PrismaClient;
}

// ---------------------------------------------------------------------------
// Unit tests: Verification and Snippet Check
// ---------------------------------------------------------------------------

describe("isSnippetVerifyingValue", () => {
  it("verifies string values present in the snippet", () => {
    expect(isSnippetVerifyingValue("Acme AI was founded in 2022", "Acme AI")).toBe(true);
    expect(isSnippetVerifyingValue("The CEO is John Doe.", "John Doe")).toBe(true);
    expect(isSnippetVerifyingValue("Visit https://acme.ai for info", "https://acme.ai")).toBe(true);
  });

  it("verifies numeric values present in the snippet", () => {
    expect(isSnippetVerifyingValue("Raised 5000000 in seed round", 5000000)).toBe(true);
    expect(isSnippetVerifyingValue("Founded in 2021", 2021)).toBe(true);
  });

  it("rejects unrelated content - do not claim a source verifies a value if unrelated", () => {
    expect(isSnippetVerifyingValue("Cookie policy: we use cookies on this site.", "Acme AI")).toBe(false);
    expect(isSnippetVerifyingValue("Copyright 2024 All Rights Reserved", "John Doe")).toBe(false);
    expect(isSnippetVerifyingValue("", "Acme AI")).toBe(false);
    expect(isSnippetVerifyingValue(null, "Acme AI")).toBe(false);
    expect(isSnippetVerifyingValue("Unrelated weather report in London", "acme.ai")).toBe(false);
  });

  it("handles case-insensitivity gracefully", () => {
    expect(isSnippetVerifyingValue("ACME AI IS REVOLUTIONARY", "acme ai")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multi-Source & Field Evidence Aggregator (buildRowEvidenceExplorer)
// ---------------------------------------------------------------------------

describe("buildRowEvidenceExplorer", () => {
  it("correctly models the multi-source prompt scenario: Company from Source A, Founder from Source B", () => {
    const rawRow = {
      id: ROW,
      datasetId: DS,
      values: {
        company: "Acme AI",
        website: "https://acme.ai",
        founder: "John Doe",
      },
      rawValues: {
        company: "Acme AI Inc.",
        website: "https://acme.ai/",
        founder: "John Doe",
      },
      confidence: 0.95,
      isValid: true,
      verificationStatus: "SOURCE_CITED_UNVERIFIED",
      qualityMetadata: {
        confidence: 0.95,
        verificationState: "SOURCE_CITED_UNVERIFIED",
        evidenceScope: "RECORD_LEVEL",
        fields: {},
        conflicts: [],
        warnings: [],
      },
      duplicateOfId: null,
      collectedAt: new Date("2026-09-01T10:00:00Z"),
      createdAt: new Date("2026-09-01T10:00:00Z"),
      dataset: { id: DS, workflowRunId: "run-1" },
      validationIssues: [],
      sourceEvidence: [
        {
          id: "ev-1",
          fieldKey: "company",
          evidenceType: "EXTRACTED",
          snippet: "Acme AI is a leading generative intelligence platform.",
          confidence: 0.95,
          retrievedAt: new Date("2026-09-01T09:00:00Z"),
          source: {
            id: SRC_A,
            url: "https://acme.ai/about",
            canonicalUrl: "https://acme.ai/about",
            domain: "acme.ai",
            title: "About Us | Acme AI",
            status: "COLLECTED",
            policyReason: null,
            robotsStatus: "ALLOWED",
            attemptCount: 1,
            retrievedAt: new Date("2026-09-01T09:00:00Z"),
            sourceMetadata: { sourceType: "scrape", stepType: "SCRAPE" },
          },
        },
        {
          id: "ev-2",
          fieldKey: "website",
          evidenceType: "EXTRACTED",
          snippet: "Official domain: https://acme.ai for enterprise queries.",
          confidence: 0.98,
          retrievedAt: new Date("2026-09-01T09:00:00Z"),
          source: {
            id: SRC_A,
            url: "https://acme.ai/about",
            canonicalUrl: "https://acme.ai/about",
            domain: "acme.ai",
            title: "About Us | Acme AI",
            status: "COLLECTED",
            policyReason: null,
            robotsStatus: "ALLOWED",
            attemptCount: 1,
            retrievedAt: new Date("2026-09-01T09:00:00Z"),
            sourceMetadata: { sourceType: "scrape", stepType: "SCRAPE" },
          },
        },
        {
          id: "ev-3",
          fieldKey: "founder",
          evidenceType: "EXTRACTED",
          snippet: "The company was founded by John Doe in late 2022.",
          confidence: 0.9,
          retrievedAt: new Date("2026-09-01T09:30:00Z"),
          source: {
            id: SRC_B,
            url: "https://techcrunch.com/acme-ai-profile",
            canonicalUrl: "https://techcrunch.com/acme-ai-profile",
            domain: "techcrunch.com",
            title: "TechCrunch: Acme AI Profile",
            status: "COLLECTED",
            policyReason: null,
            robotsStatus: "ALLOWED",
            attemptCount: 1,
            retrievedAt: new Date("2026-09-01T09:30:00Z"),
            sourceMetadata: { sourceType: "scrape", stepType: "SCRAPE" },
          },
        },
      ],
    };

    const explorer = buildRowEvidenceExplorer(rawRow);

    // Verify row-level summary
    expect(explorer.rowId).toBe(ROW);
    expect(explorer.datasetId).toBe(DS);
    expect(explorer.workflowRunId).toBe("run-1");

    // Verify distinct DatasetRowSources
    expect(explorer.sources).toHaveLength(2);
    const sourceA = explorer.sources.find((s) => s.sourceId === SRC_A);
    const sourceB = explorer.sources.find((s) => s.sourceId === SRC_B);
    expect(sourceA).toBeDefined();
    expect(sourceA?.domain).toBe("acme.ai");
    expect(sourceA?.supportedFields).toContain("company");
    expect(sourceA?.supportedFields).toContain("website");
    expect(sourceA?.evidenceCount).toBe(2);

    expect(sourceB).toBeDefined();
    expect(sourceB?.domain).toBe("techcrunch.com");
    expect(sourceB?.supportedFields).toContain("founder");
    expect(sourceB?.evidenceCount).toBe(1);

    // Verify field-level provenance
    expect(explorer.fields["company"]?.value).toBe("Acme AI");
    expect(explorer.fields["company"]?.sources[0]?.sourceId).toBe(SRC_A);
    expect(explorer.fields["company"]?.sources[0]?.url).toBe("https://acme.ai/about");
    expect(explorer.fields["company"]?.isVerified).toBe(true);

    expect(explorer.fields["website"]?.value).toBe("https://acme.ai");
    expect(explorer.fields["website"]?.sources[0]?.sourceId).toBe(SRC_A);
    expect(explorer.fields["website"]?.isVerified).toBe(true);

    expect(explorer.fields["founder"]?.value).toBe("John Doe");
    expect(explorer.fields["founder"]?.sources[0]?.sourceId).toBe(SRC_B);
    expect(explorer.fields["founder"]?.sources[0]?.url).toBe("https://techcrunch.com/acme-ai-profile");
    expect(explorer.fields["founder"]?.isVerified).toBe(true);
  });

  it("preserves conflicts where different sources disagree", () => {
    const rawRow = {
      id: ROW,
      datasetId: DS,
      values: {
        company: "Acme AI",
        funding: "$10M",
      },
      rawValues: null,
      confidence: 0.7,
      isValid: true,
      verificationStatus: "CONFLICTED",
      qualityMetadata: {
        conflicts: [
          {
            fieldKey: "funding",
            canonicalValue: "$10M",
            alternateValue: "$15M",
            canonicalSourceUrls: ["https://techcrunch.com/acme"],
            alternateSourceUrls: ["https://news.ycombinator.com/acme"],
          },
        ],
      },
      duplicateOfId: null,
      collectedAt: new Date(),
      createdAt: new Date(),
      dataset: { id: DS, workflowRunId: "run-1" },
      validationIssues: [],
      sourceEvidence: [
        {
          id: "ev-1",
          fieldKey: "funding",
          evidenceType: "EXTRACTED",
          snippet: "Acme raised $10M in Series A funding.",
          confidence: 0.8,
          retrievedAt: new Date(),
          source: {
            id: SRC_A,
            url: "https://techcrunch.com/acme",
            canonicalUrl: "https://techcrunch.com/acme",
            domain: "techcrunch.com",
            title: "TechCrunch Article",
            status: "COLLECTED",
            policyReason: null,
            robotsStatus: "ALLOWED",
            attemptCount: 1,
            retrievedAt: new Date(),
          },
        },
      ],
    };

    const explorer = buildRowEvidenceExplorer(rawRow);

    expect(explorer.fields["funding"]?.hasConflict).toBe(true);
    expect(explorer.fields["funding"]?.conflicts).toHaveLength(1);
    expect(explorer.fields["funding"]?.conflicts[0]?.alternateValue).toBe("$15M");
    expect(explorer.conflicts).toHaveLength(1);
    expect(explorer.conflicts[0]?.canonicalValue).toBe("$10M");
  });
});

// ---------------------------------------------------------------------------
// HTTP API Route Tests (Phase 10 Endpoints)
// ---------------------------------------------------------------------------

describe("Phase 10 HTTP API Endpoints", () => {
  function makeApp(prismaOverrides: Partial<MockPrisma> = {}) {
    const prisma = makePrisma(prismaOverrides);
    const repo = new DatasetQueryRepository(prisma);
    const app = express();
    app.use(express.json());
    app.use("/api/v1", createDatasetsRouter(repo));
    app.use(createErrorHandler(pino({ enabled: false })));
    return { app, prisma, repo };
  }

  // 1. GET /api/v1/rows/:id/evidence
  it("GET /api/v1/rows/:id/evidence - 200 returns full field-level and source provenance", async () => {
    const { app } = makeApp({
      datasetRow: {
        findFirst: vi.fn().mockResolvedValue({
          id: ROW,
          datasetId: DS,
          values: { company: "Acme AI", founder: "John Doe" },
          rawValues: null,
          confidence: 0.95,
          isValid: true,
          verificationStatus: "SOURCE_CITED_UNVERIFIED",
          qualityMetadata: { conflicts: [] },
          duplicateOfId: null,
          collectedAt: new Date(),
          createdAt: new Date(),
          dataset: { id: DS, workflowRunId: "run-1" },
          validationIssues: [],
          sourceEvidence: [
            {
              id: "ev-1",
              fieldKey: "company",
              evidenceType: "EXTRACTED",
              snippet: "Acme AI official documentation",
              confidence: 0.95,
              retrievedAt: new Date(),
              source: {
                id: SRC_A,
                url: "https://acme.ai",
                canonicalUrl: "https://acme.ai",
                domain: "acme.ai",
                title: "Acme AI Homepage",
                status: "COLLECTED",
                policyReason: null,
                robotsStatus: "ALLOWED",
                attemptCount: 1,
                retrievedAt: new Date(),
                sourceMetadata: { sourceType: "scrape" },
              },
              column: { key: "company", label: "Company", type: "STRING" },
            },
            {
              id: "ev-2",
              fieldKey: "founder",
              evidenceType: "EXTRACTED",
              snippet: "Founded by John Doe in 2022",
              confidence: 0.92,
              retrievedAt: new Date(),
              source: {
                id: SRC_B,
                url: "https://news.com/acme",
                canonicalUrl: "https://news.com/acme",
                domain: "news.com",
                title: "News Profile",
                status: "COLLECTED",
                policyReason: null,
                robotsStatus: "ALLOWED",
                attemptCount: 1,
                retrievedAt: new Date(),
                sourceMetadata: { sourceType: "scrape" },
              },
              column: { key: "founder", label: "Founder", type: "STRING" },
            },
          ],
        }),
        count: vi.fn(),
        findMany: vi.fn(),
      },
    });

    const res = await request(app)
      .get(`/api/v1/rows/${ROW}/evidence?workspaceId=${WS}&userId=${USER}`)
      .expect(200);

    expect(res.body.rowId).toBe(ROW);
    expect(res.body.sources).toHaveLength(2);
    expect(res.body.fields.company.value).toBe("Acme AI");
    expect(res.body.fields.company.sources[0].domain).toBe("acme.ai");
    expect(res.body.fields.founder.value).toBe("John Doe");
    expect(res.body.fields.founder.sources[0].domain).toBe("news.com");
  });

  it("GET /api/v1/rows/:id/evidence - 404 when row not found", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .get(`/api/v1/rows/${ROW}/evidence?workspaceId=${WS}&userId=${USER}`)
      .expect(404);
    expect(res.body.error.code).toBe("DATASET_ROW_NOT_FOUND");
  });

  // 2. GET /api/v1/datasets/:id/sources - preserves URL, domain, page title, retrievedAt, sourceType, workflowRunId, extractionStep, evidenceSnippet, sourceStatus
  it("GET /api/v1/datasets/:id/sources - 200 preserves all required source provenance attributes", async () => {
    const { app } = makeApp({
      dataset: {
        findFirst: vi.fn().mockResolvedValue({ workflowRunId: "run-1" }),
        count: vi.fn(),
        findMany: vi.fn(),
      },
      source: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: SRC_A,
            url: "https://acme.ai/about",
            canonicalUrl: "https://acme.ai/about",
            domain: "acme.ai",
            title: "About Acme AI",
            status: "COLLECTED",
            policyReason: null,
            robotsStatus: "ALLOWED",
            robotsCheckedAt: new Date("2026-09-01T08:00:00Z"),
            attemptCount: 1,
            lastAttemptAt: new Date("2026-09-01T08:30:00Z"),
            retrievedAt: new Date("2026-09-01T09:00:00Z"),
            errorCode: null,
            errorMessage: null,
            sourceMetadata: { sourceType: "scrape", stepType: "SCRAPE" },
            workflowRunId: "run-1",
            createdAt: new Date("2026-09-01T08:00:00Z"),
            evidence: [{ snippet: "Acme AI is an AI laboratory." }],
            _count: { evidence: 3 },
          },
        ]),
        findFirst: vi.fn(),
      },
    });

    const res = await request(app)
      .get(`/api/v1/datasets/${DS}/sources?workspaceId=${WS}&userId=${USER}&page=1&limit=10`)
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    const src = res.body.data[0];
    expect(src.url).toBe("https://acme.ai/about");
    expect(src.domain).toBe("acme.ai");
    expect(src.pageTitle).toBe("About Acme AI");
    expect(src.title).toBe("About Acme AI");
    expect(src.sourceType).toBe("scrape");
    expect(src.sourceStatus).toBe("COLLECTED");
    expect(src.status).toBe("COLLECTED");
    expect(src.workflowRunId).toBe("run-1");
    expect(src.extractionStep).toBe("SCRAPE");
    expect(src.evidenceSnippet).toBe("Acme AI is an AI laboratory.");
    expect(src.evidenceCount).toBe(3);
  });

  // 3. GET /api/v1/sources/:id - preserves all required source provenance attributes
  it("GET /api/v1/sources/:id - 200 preserves all required source attributes and evidence", async () => {
    const { app } = makeApp({
      source: {
        count: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          id: SRC_A,
          workspaceId: WS,
          workflowRunId: "run-1",
          datasetId: DS,
          url: "https://acme.ai/about",
          canonicalUrl: "https://acme.ai/about",
          domain: "acme.ai",
          title: "About Acme AI",
          status: "COLLECTED",
          policyReason: null,
          robotsStatus: "ALLOWED",
          robotsCheckedAt: new Date("2026-09-01T08:00:00Z"),
          attemptCount: 1,
          lastAttemptAt: new Date("2026-09-01T08:30:00Z"),
          retrievedAt: new Date("2026-09-01T09:00:00Z"),
          errorCode: null,
          errorMessage: null,
          sourceMetadata: { sourceType: "scrape", stepType: "SCRAPE" },
          createdAt: new Date("2026-09-01T08:00:00Z"),
          evidence: [
            {
              id: "ev-1",
              datasetId: DS,
              datasetRowId: ROW,
              fieldKey: "company",
              evidenceType: "EXTRACTED",
              snippet: "Acme AI official documentation",
              confidence: 0.95,
              retrievedAt: new Date("2026-09-01T09:00:00Z"),
            },
          ],
        }),
      },
    });

    const res = await request(app)
      .get(`/api/v1/sources/${SRC_A}?workspaceId=${WS}&userId=${USER}`)
      .expect(200);

    expect(res.body.id).toBe(SRC_A);
    expect(res.body.url).toBe("https://acme.ai/about");
    expect(res.body.domain).toBe("acme.ai");
    expect(res.body.pageTitle).toBe("About Acme AI");
    expect(res.body.sourceType).toBe("scrape");
    expect(res.body.sourceStatus).toBe("COLLECTED");
    expect(res.body.workflowRunId).toBe("run-1");
    expect(res.body.extractionStep).toBe("SCRAPE");
    expect(res.body.evidenceSnippet).toBe("Acme AI official documentation");
    expect(res.body.evidenceCount).toBe(1);
    expect(res.body.evidence).toHaveLength(1);
    expect(res.body.evidence[0].fieldKey).toBe("company");
  });

  it("GET /api/v1/sources/:id - 403 when user is not active workspace member", async () => {
    const { app } = makeApp({
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ status: "SUSPENDED" }) },
    });

    const res = await request(app)
      .get(`/api/v1/sources/${SRC_A}?workspaceId=${WS}&userId=${USER}`)
      .expect(403);

    expect(res.body.error.code).toBe("WORKSPACE_ACCESS_DENIED");
  });
});
