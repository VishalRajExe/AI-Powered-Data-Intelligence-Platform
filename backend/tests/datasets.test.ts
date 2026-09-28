/**
 * Phase 9 — Dataset Management API tests
 *
 * Tests cover:
 *  - GET /api/v1/datasets  (list, pagination, sorting, search)
 *  - GET /api/v1/datasets/:id  (detail, 404)
 *  - GET /api/v1/datasets/:id/schema
 *  - GET /api/v1/datasets/:id/rows  (pagination, search, field filters, sorting, validOnly)
 *  - GET /api/v1/datasets/:id/rows/:rowId  (evidence & lineage)
 *  - GET /api/v1/datasets/:id/rows/:rowId/evidence  (provenance alias)
 *  - GET /api/v1/datasets/:id/sources  (pagination, search, evidence count)
 *  - GET /api/v1/sources/:id  (source inspection & evidence)
 *  - Access control (workspace mismatch → 403)
 *  - Invalid filter keys → 400
 *  - DatasetQueryRepository unit-level tests + Express HTTP route tests
 */

import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import pino from "pino";
import { DatasetQueryRepository } from "../src/db/repositories/dataset-query.repository.js";
import { createDatasetsRouter } from "../src/routes/datasets.routes.js";
import { createErrorHandler } from "../src/common/errors.js";
import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Prisma mock builder
// ---------------------------------------------------------------------------

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

const WS = "00000000-0000-0000-0000-000000000001";
const USER = "00000000-0000-0000-0000-000000000002";
const DS = "00000000-0000-0000-0000-000000000003";
const ROW = "00000000-0000-0000-0000-000000000004";
const SRC = "00000000-0000-0000-0000-000000000005";

// ---------------------------------------------------------------------------
// listDatasets
// ---------------------------------------------------------------------------

describe("DatasetQueryRepository.listDatasets", () => {
  it("returns paginated empty list when no datasets", async () => {
    const repo = new DatasetQueryRepository(makePrisma());
    const result = await repo.listDatasets(WS, USER, { page: 1, limit: 20 });
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it("flattens run, columns, and quality report into dataset object", async () => {
    const prisma = makePrisma({
      dataset: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: DS,
            name: "AI Startups",
            description: null,
            status: "READY",
            recordCount: 42,
            validCount: 40,
            duplicateCount: 2,
            sourceCount: 5,
            createdAt: new Date("2026-01-01"),
            updatedAt: new Date("2026-01-02"),
            columns: [
              {
                id: "col-1",
                key: "company",
                label: "Company",
                type: "STRING",
                position: 0,
                required: true,
                filterable: true,
                sortable: true,
              },
            ],
            run: {
              id: "run-1",
              workflowId: "wf-1",
              status: "COMPLETED",
              startedAt: new Date("2026-01-01"),
              finishedAt: new Date("2026-01-02"),
              workflow: { requirement: "Find AI startups in India" },
            },
            dataQualityReport: [
              { qualityScore: 0.87, metrics: { qualityScore: 0.87 }, computedAt: new Date() },
            ],
          },
        ]),
        findFirst: vi.fn(),
      },
    });
    const repo = new DatasetQueryRepository(prisma);
    const result = await repo.listDatasets(WS, USER, { page: 1, limit: 20 });

    expect(result.data).toHaveLength(1);
    const ds = result.data[0] as Record<string, unknown>;
    expect(ds["id"]).toBe(DS);
    expect(ds["name"]).toBe("AI Startups");
    expect(ds["originalPrompt"]).toBe("Find AI startups in India");
    expect(ds["qualityScore"]).toBe(0.87);
    expect(ds["workflowId"]).toBe("wf-1");
    expect(ds["columns"]).toHaveLength(1);
    // internal relations should not be leaked raw
    expect(ds["run"]).toBeUndefined();
    expect(ds["dataQualityReport"]).toBeUndefined();
  });

  it("applies correct skip/take for page 2 limit 10", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ dataset: { count: vi.fn().mockResolvedValue(25), findMany, findFirst: vi.fn() } });
    const repo = new DatasetQueryRepository(prisma);
    await repo.listDatasets(WS, USER, { page: 2, limit: 10 }, "createdAt", "asc");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10, orderBy: { createdAt: "asc" } }),
    );
  });

  it("supports search query filter across name, description, and requirement", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = makePrisma({ dataset: { count, findMany, findFirst: vi.fn() } });
    const repo = new DatasetQueryRepository(prisma);
    await repo.listDatasets(WS, USER, { page: 1, limit: 10 }, "updatedAt", "desc", "Fintech");
    expect(count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          { name: { contains: "Fintech" } },
          { description: { contains: "Fintech" } },
          { run: { workflow: { requirement: { contains: "Fintech" } } } },
        ],
      }),
    }));
  });

  it("limits take to 200 even when caller asks for more", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ dataset: { count: vi.fn().mockResolvedValue(0), findMany, findFirst: vi.fn() } });
    const repo = new DatasetQueryRepository(prisma);
    await repo.listDatasets(WS, USER, { page: 1, limit: 9999 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
  });

  it("throws 403 if user is not an active workspace member", async () => {
    const prisma = makePrisma({
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ status: "REMOVED" }) },
    });
    const repo = new DatasetQueryRepository(prisma);
    await expect(repo.listDatasets(WS, USER, { page: 1, limit: 20 })).rejects.toMatchObject({
      statusCode: 403,
      code: "WORKSPACE_ACCESS_DENIED",
    });
  });
});

// ---------------------------------------------------------------------------
// getDataset
// ---------------------------------------------------------------------------

describe("DatasetQueryRepository.getDataset", () => {
  it("throws 404 when dataset is not found", async () => {
    const repo = new DatasetQueryRepository(makePrisma());
    await expect(repo.getDataset(WS, DS, USER)).rejects.toMatchObject({
      statusCode: 404,
      code: "DATASET_NOT_FOUND",
    });
  });

  it("returns dataset with columns and quality report when found", async () => {
    const prisma = makePrisma({
      dataset: {
        findFirst: vi.fn().mockResolvedValue({
          id: DS,
          name: "Test",
          description: "desc",
          status: "READY",
          recordCount: 10,
          validCount: 8,
          duplicateCount: 1,
          sourceCount: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
          columns: [
            { id: "col-1", key: "name", label: "Company Name", type: "STRING", position: 0, required: true, filterable: true, sortable: true },
          ],
          run: {
            id: "run-1",
            workflowId: "wf-1",
            status: "COMPLETED",
            attempt: 1,
            startedAt: new Date(),
            finishedAt: new Date(),
            workflow: { id: "wf-1", requirement: "Find startups", name: "Startup Search" },
          },
          dataQualityReport: [
            {
              qualityScore: 0.9,
              rawRecordCount: 12,
              normalizedRecordCount: 10,
              validRecordCount: 8,
              invalidRecordCount: 2,
              duplicateCount: 1,
              reviewRequiredCount: 0,
              conflictCount: 0,
              sourceBackedCount: 9,
              metrics: {},
              computedAt: new Date(),
            },
          ],
        }),
        count: vi.fn(),
        findMany: vi.fn(),
      },
    });
    const repo = new DatasetQueryRepository(prisma);
    const result = await repo.getDataset(WS, DS, USER) as Record<string, unknown>;

    expect(result["id"]).toBe(DS);
    expect(result["columns"]).toHaveLength(1);
    const col = (result["columns"] as unknown[])[0] as Record<string, unknown>;
    expect(col["key"]).toBe("name");
    const quality = result["qualityReport"] as Record<string, unknown> | null;
    expect(quality?.["qualityScore"]).toBe(0.9);
    expect(quality?.["validRecordCount"]).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// getDatasetSchema
// ---------------------------------------------------------------------------

describe("DatasetQueryRepository.getDatasetSchema", () => {
  it("returns schema with column list", async () => {
    const prisma = makePrisma({
      dataset: {
        findFirst: vi.fn().mockResolvedValue({
          id: DS,
          name: "My Dataset",
          status: "READY",
          columns: [
            { key: "company", label: "Company", type: "STRING", position: 0, required: true, filterable: true, sortable: true },
            { key: "revenue", label: "Revenue", type: "CURRENCY", position: 1, required: false, filterable: true, sortable: true },
          ],
        }),
        count: vi.fn(),
        findMany: vi.fn(),
      },
    });
    const repo = new DatasetQueryRepository(prisma);
    const result = await repo.getDatasetSchema(WS, DS, USER) as Record<string, unknown>;

    expect(result["datasetId"]).toBe(DS);
    expect((result["columns"] as unknown[]).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getDatasetRows — filtering and pagination
// ---------------------------------------------------------------------------

describe("DatasetQueryRepository.getDatasetRows", () => {
  function rowDataset() {
    return makePrisma({
      dataset: {
        findFirst: vi.fn().mockResolvedValue({
          id: DS,
          columns: [
            { key: "company_name", filterable: true },
            { key: "revenue", filterable: true },
            { key: "notes", filterable: false },
          ],
        }),
        count: vi.fn(),
        findMany: vi.fn(),
      },
      datasetRow: {
        count: vi.fn().mockResolvedValue(3),
        findMany: vi.fn().mockResolvedValue([
          { id: ROW, values: { company_name: "Acme" }, confidence: 0.8, isValid: true, verificationStatus: "SOURCE_CITED_UNVERIFIED", duplicateOfId: null, collectedAt: new Date(), createdAt: new Date(), _count: { sourceEvidence: 2 } },
        ]),
        findFirst: vi.fn(),
      },
    });
  }

  it("returns paginated rows", async () => {
    const repo = new DatasetQueryRepository(rowDataset());
    const result = await repo.getDatasetRows(WS, DS, USER, { page: 1, limit: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(3);
    const row = result.data[0] as Record<string, unknown>;
    expect(row["sourceEvidenceCount"]).toBe(2);
  });

  it("rejects non-alphanumeric filter key", async () => {
    const repo = new DatasetQueryRepository(rowDataset());
    await expect(
      repo.getDatasetRows(WS, DS, USER, {
        page: 1,
        limit: 10,
        fieldFilters: { "bad key!": "value" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_FILTER_KEY" });
  });

  it("rejects filter key not in registered columns", async () => {
    const repo = new DatasetQueryRepository(rowDataset());
    await expect(
      repo.getDatasetRows(WS, DS, USER, {
        page: 1,
        limit: 10,
        fieldFilters: { nonexistent_field: "value" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_FILTER_KEY" });
  });

  it("rejects filter key for non-filterable column", async () => {
    const repo = new DatasetQueryRepository(rowDataset());
    await expect(
      repo.getDatasetRows(WS, DS, USER, {
        page: 1,
        limit: 10,
        fieldFilters: { notes: "anything" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_FILTER_KEY" });
  });

  it("accepts valid registered filter key and calls raw query", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ id: ROW }]);
    const prisma = rowDataset();
    (prisma as unknown as MockPrisma).$queryRaw = queryRaw;
    const repo = new DatasetQueryRepository(prisma);
    await repo.getDatasetRows(WS, DS, USER, {
      page: 1,
      limit: 10,
      fieldFilters: { company_name: "Acme" },
    });
    expect(queryRaw).toHaveBeenCalled();
    const call = queryRaw.mock.calls[0];
    const sqlParts = call![0] as TemplateStringsArray;
    expect(sqlParts.join("")).toContain("JSON_EXTRACT");
  });

  it("returns empty result when search yields no rows", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]); // no matching rows
    const prisma = rowDataset();
    (prisma as unknown as MockPrisma).$queryRaw = queryRaw;
    const repo = new DatasetQueryRepository(prisma);
    const result = await repo.getDatasetRows(WS, DS, USER, {
      page: 1,
      limit: 10,
      search: "zzz_not_found",
    });
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("applies validOnly filter in WHERE clause", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = rowDataset();
    (prisma as unknown as MockPrisma).datasetRow = { count, findMany, findFirst: vi.fn() };
    const repo = new DatasetQueryRepository(prisma);
    await repo.getDatasetRows(WS, DS, USER, { page: 1, limit: 10, validOnly: true });
    expect(count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isValid: true }),
    }));
  });

  it("applies duplicatesOnly filter requiring non-null duplicateOfId", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = rowDataset();
    (prisma as unknown as MockPrisma).datasetRow = { count, findMany, findFirst: vi.fn() };
    const repo = new DatasetQueryRepository(prisma);
    await repo.getDatasetRows(WS, DS, USER, { page: 1, limit: 10, duplicatesOnly: true });
    expect(count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ duplicateOfId: { not: null } }),
    }));
  });

  it("applies confidence range filter", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = rowDataset();
    (prisma as unknown as MockPrisma).datasetRow = { count, findMany, findFirst: vi.fn() };
    const repo = new DatasetQueryRepository(prisma);
    await repo.getDatasetRows(WS, DS, USER, { page: 1, limit: 10, confidenceMin: 0.7, confidenceMax: 0.95 });
    expect(count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ confidence: { gte: 0.7, lte: 0.95 } }),
    }));
  });

  it("sorts by confidence when sort=confidence", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = rowDataset();
    (prisma as unknown as MockPrisma).datasetRow = { count, findMany, findFirst: vi.fn() };
    const repo = new DatasetQueryRepository(prisma);
    await repo.getDatasetRows(WS, DS, USER, { page: 1, limit: 10, sort: "confidence", order: "asc" });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { confidence: "asc" },
    }));
  });

  it("sorts by collectedAt when sort=collectedAt", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = rowDataset();
    (prisma as unknown as MockPrisma).datasetRow = { count, findMany, findFirst: vi.fn() };
    const repo = new DatasetQueryRepository(prisma);
    await repo.getDatasetRows(WS, DS, USER, { page: 1, limit: 10, sort: "collectedAt", order: "asc" });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { collectedAt: "asc" },
    }));
  });

  it("pagination: page 3 limit 5 skips 10 rows", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(30);
    const prisma = rowDataset();
    (prisma as unknown as MockPrisma).datasetRow = { count, findMany, findFirst: vi.fn() };
    const repo = new DatasetQueryRepository(prisma);
    const result = await repo.getDatasetRows(WS, DS, USER, { page: 3, limit: 5 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 5 }));
    expect(result.totalPages).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// getRowEvidence
// ---------------------------------------------------------------------------

describe("DatasetQueryRepository.getRowEvidence", () => {
  it("throws 404 when row not found", async () => {
    const repo = new DatasetQueryRepository(makePrisma());
    await expect(repo.getRowEvidence(WS, DS, ROW, USER)).rejects.toMatchObject({
      statusCode: 404,
      code: "DATASET_ROW_NOT_FOUND",
    });
  });

  it("returns row with evidence array", async () => {
    const prisma = makePrisma({
      datasetRow: {
        findFirst: vi.fn().mockResolvedValue({
          id: ROW,
          values: { name: "OpenAI" },
          rawValues: null,
          confidence: 0.85,
          isValid: true,
          verificationStatus: "SOURCE_CITED_UNVERIFIED",
          qualityMetadata: null,
          duplicateOfId: null,
          collectedAt: new Date(),
          createdAt: new Date(),
          validationIssues: [],
          sourceEvidence: [
            {
              id: "ev-1",
              fieldKey: null,
              evidenceType: "EXTRACTED",
              snippet: "OpenAI was founded...",
              confidence: 0.85,
              retrievedAt: new Date(),
              source: { id: "src-1", url: "https://openai.com", canonicalUrl: "https://openai.com", domain: "openai.com", title: "OpenAI", status: "COLLECTED", policyReason: null, robotsStatus: "ALLOWED", attemptCount: 1, retrievedAt: new Date(), sourceMetadata: null },
              column: null,
            },
          ],
        }),
        count: vi.fn(),
        findMany: vi.fn(),
      },
    });
    const repo = new DatasetQueryRepository(prisma);
    const result = await repo.getRowEvidence(WS, DS, ROW, USER);
    expect(result.rowId).toBe(ROW);
    expect(result.evidence.length).toBe(1);
    expect(result.evidence[0]?.source.domain).toBe("openai.com");
  });
});

// ---------------------------------------------------------------------------
// getDatasetSources
// ---------------------------------------------------------------------------

describe("DatasetQueryRepository.getDatasetSources", () => {
  it("throws 404 when dataset not found", async () => {
    const repo = new DatasetQueryRepository(makePrisma());
    await expect(repo.getDatasetSources(WS, DS, USER, { page: 1, limit: 20 })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("paginates sources and includes evidenceCount", async () => {
    const prisma = makePrisma({
      dataset: {
        findFirst: vi.fn().mockResolvedValue({ workflowRunId: "run-1" }),
        count: vi.fn(),
        findMany: vi.fn(),
      },
      source: {
        count: vi.fn().mockResolvedValue(2),
        findMany: vi.fn().mockResolvedValue([
          { id: "src-1", url: "https://a.com", canonicalUrl: "https://a.com", domain: "a.com", title: "A", status: "COLLECTED", policyReason: null, robotsStatus: "ALLOWED", robotsCheckedAt: null, attemptCount: 1, lastAttemptAt: null, retrievedAt: new Date(), errorCode: null, errorMessage: null, sourceMetadata: null, createdAt: new Date(), _count: { evidence: 3 } },
          { id: "src-2", url: "https://b.com", canonicalUrl: "https://b.com", domain: "b.com", title: "B", status: "BLOCKED", policyReason: "robots_disallowed", robotsStatus: "DISALLOWED", robotsCheckedAt: new Date(), attemptCount: 0, lastAttemptAt: null, retrievedAt: null, errorCode: null, errorMessage: null, sourceMetadata: null, createdAt: new Date(), _count: { evidence: 0 } },
        ]),
        findFirst: vi.fn(),
      },
    });
    const repo = new DatasetQueryRepository(prisma);
    const result = await repo.getDatasetSources(WS, DS, USER, { page: 1, limit: 20 });
    expect(result.total).toBe(2);
    const sources = result.data as Array<Record<string, unknown>>;
    expect(sources[0]?.["evidenceCount"]).toBe(3);
    expect(sources[1]?.["policyReason"]).toBe("robots_disallowed");
    expect(sources[0]?.["_count"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getSource
// ---------------------------------------------------------------------------

describe("DatasetQueryRepository.getSource", () => {
  it("throws 404 when source not found", async () => {
    const repo = new DatasetQueryRepository(makePrisma());
    await expect(repo.getSource(WS, SRC, USER)).rejects.toMatchObject({
      statusCode: 404,
      code: "SOURCE_NOT_FOUND",
    });
  });

  it("returns source with linked evidence", async () => {
    const prisma = makePrisma({
      source: {
        count: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          id: SRC,
          workspaceId: WS,
          workflowRunId: "run-1",
          datasetId: DS,
          url: "https://example.com/data",
          canonicalUrl: "https://example.com/data",
          domain: "example.com",
          title: "Data Source",
          status: "COLLECTED",
          policyReason: null,
          robotsStatus: "ALLOWED",
          robotsCheckedAt: null,
          attemptCount: 1,
          lastAttemptAt: null,
          retrievedAt: new Date(),
          errorCode: null,
          errorMessage: null,
          sourceMetadata: { headers: {} },
          createdAt: new Date(),
          evidence: [
            {
              id: "ev-1",
              datasetId: DS,
              datasetRowId: ROW,
              fieldKey: "company",
              evidenceType: "EXTRACTED",
              snippet: "Founded in 2020",
              confidence: 0.95,
              retrievedAt: new Date(),
            },
          ],
        }),
      },
    });
    const repo = new DatasetQueryRepository(prisma);
    const result = await repo.getSource(WS, SRC, USER) as Record<string, unknown>;
    expect(result["id"]).toBe(SRC);
    expect(result["domain"]).toBe("example.com");
    expect((result["evidence"] as unknown[])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Express HTTP Routing Integration Tests (Phase 9 API)
// ---------------------------------------------------------------------------

describe("Phase 9 Express HTTP Routing (createDatasetsRouter)", () => {
  function makeApp(prismaOverrides: Partial<MockPrisma> = {}) {
    const prisma = makePrisma(prismaOverrides);
    const repo = new DatasetQueryRepository(prisma);
    const app = express();
    app.use(express.json());
    app.use("/api/v1", createDatasetsRouter(repo));
    app.use(createErrorHandler(pino({ enabled: false })));
    return { app, prisma, repo };
  }

  it("GET /api/v1/datasets - 200 returns paginated datasets with columns and quality report", async () => {
    const { app } = makeApp({
      dataset: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: DS,
            name: "AI Companies",
            description: "Targeted research dataset",
            status: "READY",
            recordCount: 50,
            validCount: 48,
            duplicateCount: 2,
            sourceCount: 8,
            createdAt: new Date(),
            updatedAt: new Date(),
            columns: [
              { id: "col-1", key: "name", label: "Name", type: "STRING", position: 0, required: true, filterable: true, sortable: true },
            ],
            run: {
              id: "run-1",
              workflowId: "wf-1",
              status: "COMPLETED",
              startedAt: new Date(),
              finishedAt: new Date(),
              workflow: { requirement: "Find all AI companies" },
            },
            dataQualityReport: [
              { qualityScore: 0.92, metrics: { qualityScore: 0.92 }, computedAt: new Date() },
            ],
          },
        ]),
        findFirst: vi.fn(),
      },
    });

    const res = await request(app)
      .get(`/api/v1/datasets?workspaceId=${WS}&userId=${USER}&page=1&limit=10&search=AI`)
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].id).toBe(DS);
    expect(res.body.data[0].originalPrompt).toBe("Find all AI companies");
    expect(res.body.data[0].columns).toHaveLength(1);
    expect(res.body.data[0].qualityScore).toBe(0.92);
  });

  it("GET /api/v1/datasets - 400 validation error when workspaceId missing", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .get(`/api/v1/datasets?userId=${USER}`)
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("GET /api/v1/datasets/:id - 200 returns dataset with columns and quality details", async () => {
    const { app } = makeApp({
      dataset: {
        findFirst: vi.fn().mockResolvedValue({
          id: DS,
          name: "AI Companies",
          description: "Targeted research dataset",
          status: "READY",
          recordCount: 50,
          validCount: 48,
          duplicateCount: 2,
          sourceCount: 8,
          createdAt: new Date(),
          updatedAt: new Date(),
          columns: [
            { id: "col-1", key: "name", label: "Name", type: "STRING", position: 0, required: true, filterable: true, sortable: true },
          ],
          run: {
            id: "run-1",
            workflowId: "wf-1",
            status: "COMPLETED",
            attempt: 1,
            startedAt: new Date(),
            finishedAt: new Date(),
            workflow: { id: "wf-1", requirement: "Find all AI companies", name: "AI Search" },
          },
          dataQualityReport: [
            {
              qualityScore: 0.95,
              rawRecordCount: 52,
              normalizedRecordCount: 50,
              validRecordCount: 48,
              invalidRecordCount: 2,
              duplicateCount: 2,
              reviewRequiredCount: 0,
              conflictCount: 0,
              sourceBackedCount: 48,
              metrics: {},
              computedAt: new Date(),
            },
          ],
        }),
        count: vi.fn(),
        findMany: vi.fn(),
      },
    });

    const res = await request(app)
      .get(`/api/v1/datasets/${DS}?workspaceId=${WS}&userId=${USER}`)
      .expect(200);

    expect(res.body.id).toBe(DS);
    expect(res.body.name).toBe("AI Companies");
    expect(res.body.columns).toHaveLength(1);
    expect(res.body.qualityReport.qualityScore).toBe(0.95);
  });

  it("GET /api/v1/datasets/:id - 404 when dataset does not exist", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .get(`/api/v1/datasets/${DS}?workspaceId=${WS}&userId=${USER}`)
      .expect(404);
    expect(res.body.error.code).toBe("DATASET_NOT_FOUND");
  });

  it("GET /api/v1/datasets/:id/schema - 200 returns schema columns", async () => {
    const { app } = makeApp({
      dataset: {
        findFirst: vi.fn().mockResolvedValue({
          id: DS,
          name: "AI Companies",
          status: "READY",
          columns: [
            { key: "company", label: "Company", type: "STRING", position: 0, required: true, filterable: true, sortable: true },
          ],
        }),
        count: vi.fn(),
        findMany: vi.fn(),
      },
    });

    const res = await request(app)
      .get(`/api/v1/datasets/${DS}/schema?workspaceId=${WS}&userId=${USER}`)
      .expect(200);

    expect(res.body.datasetId).toBe(DS);
    expect(res.body.columns).toHaveLength(1);
    expect(res.body.columns[0].key).toBe("company");
  });

  it("GET /api/v1/datasets/:id/rows - 200 with search, validOnly, and sorting", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ id: ROW }]);
    const { app } = makeApp({
      dataset: {
        findFirst: vi.fn().mockResolvedValue({
          id: DS,
          columns: [{ key: "company", filterable: true, sortable: true }],
        }),
        count: vi.fn(),
        findMany: vi.fn(),
      },
      datasetRow: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: ROW,
            values: { company: "Google" },
            confidence: 0.98,
            isValid: true,
            verificationStatus: "SOURCE_CITED_UNVERIFIED",
            duplicateOfId: null,
            collectedAt: new Date(),
            createdAt: new Date(),
            _count: { sourceEvidence: 1 },
          },
        ]),
        findFirst: vi.fn(),
      },
      $queryRaw: queryRaw,
    });

    const res = await request(app)
      .get(`/api/v1/datasets/${DS}/rows?workspaceId=${WS}&userId=${USER}&page=1&limit=20&search=Google&validOnly=true&sort=confidence&order=desc`)
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(ROW);
    expect(res.body.data[0].values.company).toBe("Google");
    expect(res.body.data[0].sourceEvidenceCount).toBe(1);
  });

  it("GET /api/v1/datasets/:id/rows - supports filters[field]=val query syntax", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ id: ROW }]);
    const { app } = makeApp({
      dataset: {
        findFirst: vi.fn().mockResolvedValue({
          id: DS,
          columns: [{ key: "company", filterable: true, sortable: true }],
        }),
        count: vi.fn(),
        findMany: vi.fn(),
      },
      datasetRow: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: ROW,
            values: { company: "Acme" },
            confidence: 0.9,
            isValid: true,
            verificationStatus: "SOURCE_CITED_UNVERIFIED",
            duplicateOfId: null,
            collectedAt: new Date(),
            createdAt: new Date(),
            _count: { sourceEvidence: 1 },
          },
        ]),
        findFirst: vi.fn(),
      },
      $queryRaw: queryRaw,
    });

    const res = await request(app)
      .get(`/api/v1/datasets/${DS}/rows?workspaceId=${WS}&userId=${USER}&filters[company]=Acme`)
      .expect(200);

    expect(res.body.data).toHaveLength(1);
  });

  it("GET /api/v1/datasets/:id/rows - 400 when invalid filter key format", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .get(`/api/v1/datasets/${DS}/rows?workspaceId=${WS}&userId=${USER}&filters[invalid%20key!]=val`)
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("GET /api/v1/datasets/:id/rows/:rowId - 200 returns row evidence and source lineage", async () => {
    const { app } = makeApp({
      datasetRow: {
        findFirst: vi.fn().mockResolvedValue({
          id: ROW,
          values: { company: "OpenAI", location: "San Francisco" },
          rawValues: { company: "OpenAI" },
          confidence: 0.95,
          isValid: true,
          verificationStatus: "SOURCE_CITED_UNVERIFIED",
          qualityMetadata: { pass: true },
          duplicateOfId: null,
          collectedAt: new Date(),
          createdAt: new Date(),
          validationIssues: [],
          sourceEvidence: [
            {
              id: "ev-1",
              fieldKey: "company",
              evidenceType: "EXTRACTED",
              snippet: "OpenAI is an AI research company.",
              confidence: 0.95,
              retrievedAt: new Date(),
              source: {
                id: SRC,
                url: "https://openai.com/about",
                canonicalUrl: "https://openai.com/about",
                domain: "openai.com",
                title: "About OpenAI",
                status: "COLLECTED",
                policyReason: null,
                robotsStatus: "ALLOWED",
                attemptCount: 1,
                retrievedAt: new Date(),
                sourceMetadata: {},
              },
              column: { key: "company", label: "Company", type: "STRING" },
            },
          ],
        }),
        count: vi.fn(),
        findMany: vi.fn(),
      },
    });

    const res = await request(app)
      .get(`/api/v1/datasets/${DS}/rows/${ROW}?workspaceId=${WS}&userId=${USER}`)
      .expect(200);

    expect(res.body.rowId).toBe(ROW);
    expect(res.body.evidence).toHaveLength(1);
    expect(res.body.evidence[0].source.url).toBe("https://openai.com/about");
    expect(res.body.evidence[0].snippet).toBe("OpenAI is an AI research company.");
  });

  it("GET /api/v1/datasets/:id/rows/:rowId/evidence - alias returns same lineage data", async () => {
    const { app } = makeApp({
      datasetRow: {
        findFirst: vi.fn().mockResolvedValue({
          id: ROW,
          values: { company: "OpenAI" },
          rawValues: null,
          confidence: 0.95,
          isValid: true,
          verificationStatus: "SOURCE_CITED_UNVERIFIED",
          qualityMetadata: null,
          duplicateOfId: null,
          collectedAt: new Date(),
          createdAt: new Date(),
          validationIssues: [],
          sourceEvidence: [],
        }),
        count: vi.fn(),
        findMany: vi.fn(),
      },
    });

    const res = await request(app)
      .get(`/api/v1/datasets/${DS}/rows/${ROW}/evidence?workspaceId=${WS}&userId=${USER}`)
      .expect(200);

    expect(res.body.rowId).toBe(ROW);
    expect(res.body.evidence).toEqual([]);
  });

  it("GET /api/v1/datasets/:id/sources - 200 returns paginated sources", async () => {
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
            id: SRC,
            url: "https://techcrunch.com/article",
            canonicalUrl: "https://techcrunch.com/article",
            domain: "techcrunch.com",
            title: "Article Title",
            status: "COLLECTED",
            policyReason: null,
            robotsStatus: "ALLOWED",
            robotsCheckedAt: null,
            attemptCount: 1,
            lastAttemptAt: null,
            retrievedAt: new Date(),
            errorCode: null,
            errorMessage: null,
            sourceMetadata: null,
            createdAt: new Date(),
            _count: { evidence: 5 },
          },
        ]),
        findFirst: vi.fn(),
      },
    });

    const res = await request(app)
      .get(`/api/v1/datasets/${DS}/sources?workspaceId=${WS}&userId=${USER}&page=1&limit=10&search=techcrunch`)
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(SRC);
    expect(res.body.data[0].evidenceCount).toBe(5);
  });

  it("GET /api/v1/sources/:id - 200 returns source details and evidence", async () => {
    const { app } = makeApp({
      source: {
        count: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          id: SRC,
          workspaceId: WS,
          workflowRunId: "run-1",
          datasetId: DS,
          url: "https://example.com/source",
          canonicalUrl: "https://example.com/source",
          domain: "example.com",
          title: "Source Title",
          status: "COLLECTED",
          policyReason: null,
          robotsStatus: "ALLOWED",
          robotsCheckedAt: null,
          attemptCount: 1,
          lastAttemptAt: null,
          retrievedAt: new Date(),
          errorCode: null,
          errorMessage: null,
          sourceMetadata: {},
          createdAt: new Date(),
          evidence: [
            {
              id: "ev-1",
              datasetId: DS,
              datasetRowId: ROW,
              fieldKey: "title",
              evidenceType: "EXTRACTED",
              snippet: "Sample snippet",
              confidence: 0.9,
              retrievedAt: new Date(),
            },
          ],
        }),
      },
    });

    const res = await request(app)
      .get(`/api/v1/sources/${SRC}?workspaceId=${WS}&userId=${USER}`)
      .expect(200);

    expect(res.body.id).toBe(SRC);
    expect(res.body.domain).toBe("example.com");
    expect(res.body.evidence).toHaveLength(1);
    expect(res.body.evidence[0].snippet).toBe("Sample snippet");
  });

  it("GET /api/v1/sources/:id - 404 when source not found", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .get(`/api/v1/sources/${SRC}?workspaceId=${WS}&userId=${USER}`)
      .expect(404);
    expect(res.body.error.code).toBe("SOURCE_NOT_FOUND");
  });
});
