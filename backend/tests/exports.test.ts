import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import ExcelJS from "exceljs";
import request from "supertest";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnvConfig } from "../src/config/env.js";
import { MockAgentAdapter } from "../src/agent/MockAgentAdapter.js";
import { DatasetQueryRepository } from "../src/db/repositories/dataset-query.repository.js";
import { ExportRepository } from "../src/db/repositories/export.repository.js";
import { ExportService } from "../src/modules/export/export.service.js";
import { escapeCsvCell } from "../src/modules/export/format-writers.js";
import type { PrismaClient, ExportFormat, ExportJobStatus } from "@prisma/client";
import pino from "pino";
import type { RequirementParser } from "../src/modules/requirements/parser.service.js";
import type { WorkflowPlanner } from "../src/modules/planner/planner.service.js";
import type { WorkflowExecutionServiceContract } from "../src/modules/workflows/workflow-execution.service.js";

const WS_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const OTHER_WS_ID = "00000000-0000-0000-0000-000000000000";
const USER_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const DATASET_ID = "c3d4e5f6-a7b8-9012-cdef-123456789012";

interface StoredExportJob {
  id: string;
  workspaceId: string;
  datasetId: string;
  requestedById: string;
  format: ExportFormat;
  status: ExportJobStatus;
  filters: unknown;
  sort: unknown;
  fileKey: string | null;
  fileMetadata: unknown;
  expiresAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function createMockPrisma(_storageDir?: string) {
  void _storageDir;
  const exportJobs = new Map<string, StoredExportJob>();

  const columns = [
    { id: "col-1", workspaceId: WS_ID, datasetId: DATASET_ID, key: "companyName", label: "Company Name", type: "STRING" as const, position: 1, required: true, filterable: true, sortable: true },
    { id: "col-2", workspaceId: WS_ID, datasetId: DATASET_ID, key: "revenue", label: "Annual Revenue", type: "NUMBER" as const, position: 2, required: false, filterable: true, sortable: true },
    { id: "col-3", workspaceId: WS_ID, datasetId: DATASET_ID, key: "country", label: "Country", type: "STRING" as const, position: 3, required: false, filterable: true, sortable: true },
    { id: "col-4", workspaceId: WS_ID, datasetId: DATASET_ID, key: "notes", label: "Notes", type: "STRING" as const, position: 4, required: false, filterable: true, sortable: true },
  ];

  const sampleRows = [
    {
      id: "row-1",
      workspaceId: WS_ID,
      datasetId: DATASET_ID,
      values: { companyName: "Acme AI, Inc.", revenue: 1500000, country: "US", notes: 'He said "Welcome"\nLine 2' },
      confidence: 0.95,
      isValid: true,
      verificationStatus: "SOURCE_CITED_UNVERIFIED",
      duplicateOfId: null,
      collectedAt: new Date("2026-09-28T09:00:00Z"),
      createdAt: new Date("2026-09-28T09:00:00Z"),
      _count: { sourceEvidence: 2 },
    },
    {
      id: "row-2",
      workspaceId: WS_ID,
      datasetId: DATASET_ID,
      values: { companyName: "Beta Corp", revenue: 800000, country: "UK", notes: "Simple notes" },
      confidence: 0.88,
      isValid: true,
      verificationStatus: "SOURCE_CITED_UNVERIFIED",
      duplicateOfId: null,
      collectedAt: new Date("2026-09-28T09:01:00Z"),
      createdAt: new Date("2026-09-28T09:01:00Z"),
      _count: { sourceEvidence: 1 },
    },
    {
      id: "row-3",
      workspaceId: WS_ID,
      datasetId: DATASET_ID,
      values: { companyName: "Gamma Robotics", revenue: 2000000, country: "US", notes: null },
      confidence: 0.75,
      isValid: false,
      verificationStatus: "UNSUPPORTED",
      duplicateOfId: "row-1",
      collectedAt: new Date("2026-09-28T09:02:00Z"),
      createdAt: new Date("2026-09-28T09:02:00Z"),
      _count: { sourceEvidence: 0 },
    },
  ];

  const mock = {
    workspaceMember: {
      findUnique: async (args: { where: { workspaceId_userId: { workspaceId: string; userId: string } } }) => {
        if (args.where.workspaceId_userId.workspaceId === WS_ID && args.where.workspaceId_userId.userId === USER_ID) {
          return { status: "ACTIVE" };
        }
        return null;
      },
    },
    dataset: {
      findFirst: async (args: { where: { workspaceId: string; id: string } }) => {
        if (args.where.workspaceId === WS_ID && args.where.id === DATASET_ID) {
          return {
            id: DATASET_ID,
            workspaceId: WS_ID,
            name: "Tech Companies Dataset",
            description: "Curated tech companies",
            status: "READY",
            recordCount: sampleRows.length,
            validCount: 2,
            duplicateCount: 1,
            sourceCount: 3,
            createdAt: new Date("2026-09-28T08:00:00Z"),
            updatedAt: new Date("2026-09-28T08:00:00Z"),
            columns,
            dataQualityReport: [],
          };
        }
        return null;
      },
    },
    datasetRow: {
      count: async (args: { where: Record<string, unknown> }) => {
        let filtered = sampleRows;
        if (args.where.isValid === true) filtered = filtered.filter((r) => r.isValid);
        if (args.where.duplicateOfId) filtered = filtered.filter((r) => r.duplicateOfId !== null);
        return filtered.length;
      },
      findMany: async (args: { where: Record<string, unknown>; skip?: number; take?: number }) => {
        let filtered = [...sampleRows];
        if (args.where.isValid === true) filtered = filtered.filter((r) => r.isValid);
        if (args.where.duplicateOfId) filtered = filtered.filter((r) => r.duplicateOfId !== null);
        if (args.where.id && typeof args.where.id === "object" && "in" in (args.where.id as Record<string, unknown>)) {
          const ids = new Set((args.where.id as { in: string[] }).in);
          filtered = filtered.filter((r) => ids.has(r.id));
        }

        const skip = args.skip ?? 0;
        const take = args.take ?? filtered.length;
        return filtered.slice(skip, skip + take);
      },
    },
    exportJob: {
      create: async (args: { data: Record<string, unknown> }) => {
        const id = crypto.randomUUID();
        const record: StoredExportJob = {
          id,
          workspaceId: String(args.data.workspaceId),
          datasetId: String(args.data.datasetId),
          requestedById: String(args.data.requestedById),
          format: args.data.format as ExportFormat,
          status: (args.data.status as ExportJobStatus) ?? "PENDING",
          filters: args.data.filters ?? null,
          sort: args.data.sort ?? null,
          fileKey: null,
          fileMetadata: null,
          expiresAt: null,
          errorCode: null,
          errorMessage: null,
          startedAt: null,
          finishedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        exportJobs.set(id, record);
        return record;
      },
      findFirst: async (args: { where: { workspaceId: string; id: string } }) => {
        const job = exportJobs.get(args.where.id);
        if (job && job.workspaceId === args.where.workspaceId) {
          return job;
        }
        return null;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = exportJobs.get(args.where.id);
        if (!existing) throw new Error("Job not found");
        const updated: StoredExportJob = {
          ...existing,
          ...args.data,
          status: (args.data.status as ExportJobStatus) ?? existing.status,
          updatedAt: new Date(),
        };
        exportJobs.set(args.where.id, updated);
        return updated;
      },
    },
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      // Mock parameterised queries for search / field filters
      const searchVal = values.find((v) => typeof v === "string" && v.startsWith("%"));
      if (searchVal) {
        const query = String(searchVal).replace(/%/g, "").toLowerCase();
        return sampleRows
          .filter((r) => JSON.stringify(r.values).toLowerCase().includes(query))
          .map((r) => ({ id: r.id }));
      }
      return sampleRows.map((r) => ({ id: r.id }));
    },
  };

  return { prisma: mock as unknown as PrismaClient, exportJobs, sampleRows, columns };
}

describe("Phase 12 — Data Export & Verification", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aidp-export-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("1. CSV Escaping (RFC 4180)", () => {
    it("preserves quotes, commas, newlines, objects, numbers, and nulls properly", () => {
      expect(escapeCsvCell(null)).toBe("");
      expect(escapeCsvCell(undefined)).toBe("");
      expect(escapeCsvCell(true)).toBe("true");
      expect(escapeCsvCell(false)).toBe("false");
      expect(escapeCsvCell(12345)).toBe("12345");
      expect(escapeCsvCell("Simple text")).toBe("Simple text");
      expect(escapeCsvCell("Text, with comma")).toBe('"Text, with comma"');
      expect(escapeCsvCell('He said "Hello"')).toBe('"He said ""Hello"""');
      expect(escapeCsvCell("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
      expect(escapeCsvCell('Combo: "A", B\nC')).toBe('"Combo: ""A"", B\nC"');
      expect(escapeCsvCell({ a: 1, b: "two" })).toBe('"{""a"":1,""b"":""two""}"');
    });
  });

  describe("2. End-to-End File Generation & Verification", () => {
    it("generates a valid CSV file with chunked streaming and proper escaping", async () => {
      const { prisma } = createMockPrisma(tempDir);
      const datasetRepo = new DatasetQueryRepository(prisma);
      const exportRepo = new ExportRepository(prisma, tempDir);
      const exportService = new ExportService(exportRepo, datasetRepo, {
        chunkSize: 1, // force chunking
        logger: pino({ level: "silent" }),
      });

      const job = await exportService.createAndProcessExport(
        {
          workspaceId: WS_ID,
          userId: USER_ID,
          datasetId: DATASET_ID,
          format: "CSV",
        },
        true, // wait for completion
      );

      expect(job.status).toBe("COMPLETED");
      expect(job.fileMetadata).toBeDefined();
      expect(job.fileMetadata?.rowCount).toBe(3);
      expect(job.fileMetadata?.columnCount).toBe(4);
      expect(job.fileMetadata?.contentType).toBe("text/csv; charset=utf-8");

      const filePath = path.resolve(tempDir, job.fileMetadata!.fileName);
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\r\n");

      // Verify header
      expect(lines[0]).toBe("Company Name,Annual Revenue,Country,Notes");

      // Verify escaped quotes & newlines in row 1
      expect(lines[1]).toContain('"Acme AI, Inc."');
      expect(lines[1]).toContain('1500000');
      expect(lines[1]).toContain('US');
      expect(content).toContain('"He said ""Welcome""\nLine 2"');
    });

    it("generates a valid JSON file with valid syntax and chunked streaming", async () => {
      const { prisma } = createMockPrisma(tempDir);
      const datasetRepo = new DatasetQueryRepository(prisma);
      const exportRepo = new ExportRepository(prisma, tempDir);
      const exportService = new ExportService(exportRepo, datasetRepo, {
        chunkSize: 2,
        logger: pino({ level: "silent" }),
      });

      const job = await exportService.createAndProcessExport(
        {
          workspaceId: WS_ID,
          userId: USER_ID,
          datasetId: DATASET_ID,
          format: "JSON",
        },
        true,
      );

      expect(job.status).toBe("COMPLETED");
      const filePath = path.resolve(tempDir, job.fileMetadata!.fileName);
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, "utf8");
      // JSON syntax must be 100% valid
      const parsed = JSON.parse(content) as Array<Record<string, unknown>>;
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(3);
      expect(parsed[0]?.companyName).toBe("Acme AI, Inc.");
      expect(parsed[0]?.revenue).toBe(1500000);
      expect(parsed[1]?.companyName).toBe("Beta Corp");
      expect(parsed[2]?.notes).toBeNull();
    });

    it("generates a valid XLSX file that opens correctly with ExcelJS", async () => {
      const { prisma } = createMockPrisma(tempDir);
      const datasetRepo = new DatasetQueryRepository(prisma);
      const exportRepo = new ExportRepository(prisma, tempDir);
      const exportService = new ExportService(exportRepo, datasetRepo, {
        chunkSize: 2,
        logger: pino({ level: "silent" }),
      });

      const job = await exportService.createAndProcessExport(
        {
          workspaceId: WS_ID,
          userId: USER_ID,
          datasetId: DATASET_ID,
          format: "XLSX",
        },
        true,
      );

      expect(job.status).toBe("COMPLETED");
      expect(job.fileMetadata?.contentType).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );

      const filePath = path.resolve(tempDir, job.fileMetadata!.fileName);
      expect(fs.existsSync(filePath)).toBe(true);

      // Verify the generated XLSX by reading it with ExcelJS
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);

      const worksheet = workbook.getWorksheet("Dataset");
      expect(worksheet).toBeDefined();

      // Check header values
      const headers = worksheet?.getRow(1).values as string[];
      expect(headers).toContain("Company Name");
      expect(headers).toContain("Annual Revenue");
      expect(headers).toContain("Country");

      // Check rows count (header + 3 data rows)
      expect(worksheet?.rowCount).toBe(4);

      // Check row 2 (first data row) values
      const row2 = worksheet?.getRow(2);
      expect(row2?.getCell(1).value).toBe("Acme AI, Inc.");
      expect(row2?.getCell(2).value).toBe(1500000);
      expect(row2?.getCell(3).value).toBe("US");
    });
  });

  describe("3. Filtered & Selected Columns Export", () => {
    it("supports selected columns subset", async () => {
      const { prisma } = createMockPrisma(tempDir);
      const datasetRepo = new DatasetQueryRepository(prisma);
      const exportRepo = new ExportRepository(prisma, tempDir);
      const exportService = new ExportService(exportRepo, datasetRepo, {
        logger: pino({ level: "silent" }),
      });

      const job = await exportService.createAndProcessExport(
        {
          workspaceId: WS_ID,
          userId: USER_ID,
          datasetId: DATASET_ID,
          format: "CSV",
          filterDefinition: {
            columns: ["companyName", "country"], // Only 2 columns selected
          },
        },
        true,
      );

      expect(job.status).toBe("COMPLETED");
      expect(job.fileMetadata?.columnCount).toBe(2);

      const filePath = path.resolve(tempDir, job.fileMetadata!.fileName);
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\r\n");

      // Verify only selected columns in header
      expect(lines[0]).toBe("Company Name,Country");
      expect(lines[1]).toBe('"Acme AI, Inc.",US');
      expect(lines[2]).toBe("Beta Corp,UK");
    });

    it("supports filtering rows (e.g. validOnly)", async () => {
      const { prisma } = createMockPrisma(tempDir);
      const datasetRepo = new DatasetQueryRepository(prisma);
      const exportRepo = new ExportRepository(prisma, tempDir);
      const exportService = new ExportService(exportRepo, datasetRepo, {
        logger: pino({ level: "silent" }),
      });

      const job = await exportService.createAndProcessExport(
        {
          workspaceId: WS_ID,
          userId: USER_ID,
          datasetId: DATASET_ID,
          format: "JSON",
          filterDefinition: {
            validOnly: true, // gamma is invalid, so only 2 rows should be exported
          },
        },
        true,
      );

      expect(job.status).toBe("COMPLETED");
      expect(job.fileMetadata?.rowCount).toBe(2);

      const filePath = path.resolve(tempDir, job.fileMetadata!.fileName);
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Array<Record<string, unknown>>;
      expect(parsed).toHaveLength(2);
      expect(parsed.some((r) => r.companyName === "Gamma Robotics")).toBe(false);
    });
  });

  describe("4. API Endpoints & Authorization", () => {
    function createTestApp() {
      const { prisma } = createMockPrisma(tempDir);
      const config = loadEnvConfig({
        APP_ENV: "test",
        MYSQL_HOST: "localhost",
        MYSQL_PORT: "3306",
        MYSQL_USER: "aidp",
        MYSQL_PASSWORD: "",
        MYSQL_DATABASE: "aidp_test",
      });
      const logger = pino({ level: "silent" });
      const datasetRepo = new DatasetQueryRepository(prisma);
      const exportRepo = new ExportRepository(prisma, tempDir);
      const exportService = new ExportService(exportRepo, datasetRepo, {
        logger,
      });

      const app = createApp({
        config,
        logger,
        readiness: { mysql: async () => {}, redis: async () => {} },
        requirementParser: {} as unknown as RequirementParser,
        workflowPlanner: {} as unknown as WorkflowPlanner,
        workflowExecution: {} as unknown as WorkflowExecutionServiceContract,
        agentAdapter: new MockAgentAdapter(),
        datasetQueryRepository: datasetRepo,
        exportRepository: exportRepo,
        exportService,
      });

      return { app, exportService, exportRepo };
    }

    it("POST /api/v1/datasets/:id/exports accepts and returns 202 with PENDING job", async () => {
      const { app } = createTestApp();

      const res = await request(app)
        .post(`/api/v1/datasets/${DATASET_ID}/exports`)
        .send({
          workspaceId: WS_ID,
          userId: USER_ID,
          format: "CSV",
          columns: ["companyName", "revenue"],
        });

      expect(res.status).toBe(202);
      expect(res.body.id).toBeDefined();
      expect(res.body.datasetId).toBe(DATASET_ID);
      expect(res.body.format).toBe("CSV");
      expect(res.body.filterDefinition?.columns).toEqual(["companyName", "revenue"]);
      expect(["PENDING", "RUNNING", "COMPLETED"]).toContain(res.body.status);
    });

    it("rejects export creation if workspace membership is missing (403)", async () => {
      const { app } = createTestApp();

      const res = await request(app)
        .post(`/api/v1/datasets/${DATASET_ID}/exports`)
        .send({
          workspaceId: OTHER_WS_ID, // unauthorized workspace
          userId: USER_ID,
          format: "CSV",
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("WORKSPACE_ACCESS_DENIED");
    });

    it("rejects non-existent dataset with 404", async () => {
      const { app } = createTestApp();

      const res = await request(app)
        .post("/api/v1/datasets/99999999-9999-9999-9999-999999999999/exports")
        .send({
          workspaceId: WS_ID,
          userId: USER_ID,
          format: "JSON",
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("DATASET_NOT_FOUND");
    });

    it("GET /api/v1/exports/:id returns job status and fileMetadata", async () => {
      const { app, exportService } = createTestApp();

      // Create and wait for completion
      const completedJob = await exportService.createAndProcessExport(
        {
          workspaceId: WS_ID,
          userId: USER_ID,
          datasetId: DATASET_ID,
          format: "CSV",
        },
        true,
      );

      const res = await request(app)
        .get(`/api/v1/exports/${completedJob.id}`)
        .query({ workspaceId: WS_ID, userId: USER_ID });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(completedJob.id);
      expect(res.body.status).toBe("COMPLETED");
      expect(res.body.fileMetadata).toBeDefined();
      expect(res.body.fileMetadata.rowCount).toBe(3);
      expect(res.body.downloadUrl).toBe(`/api/v1/exports/${completedJob.id}/download`);
    });

    it("GET /api/v1/exports/:id/download downloads the completed file with proper headers", async () => {
      const { app, exportService } = createTestApp();

      const completedJob = await exportService.createAndProcessExport(
        {
          workspaceId: WS_ID,
          userId: USER_ID,
          datasetId: DATASET_ID,
          format: "CSV",
        },
        true,
      );

      const res = await request(app)
        .get(`/api/v1/exports/${completedJob.id}/download`)
        .query({ workspaceId: WS_ID, userId: USER_ID });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
      expect(res.headers["content-disposition"]).toContain("attachment; filename=");
      expect(res.text).toContain("Company Name,Annual Revenue,Country,Notes");
      expect(res.text).toContain("Acme AI, Inc.");
    });

    it("GET /api/v1/exports/:id/download returns 400 EXPORT_NOT_READY when job is not COMPLETED", async () => {
      const { app, exportRepo } = createTestApp();

      // Create a pending job directly
      const pendingJob = await exportRepo.createExportJob({
        workspaceId: WS_ID,
        userId: USER_ID,
        datasetId: DATASET_ID,
        format: "CSV",
      });

      const res = await request(app)
        .get(`/api/v1/exports/${pendingJob.id}/download`)
        .query({ workspaceId: WS_ID, userId: USER_ID });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("EXPORT_NOT_READY");
    });
  });
});
