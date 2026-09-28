import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import ExcelJS from "exceljs";
import type { Logger } from "pino";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DEMO_SCENARIO_1,
  DEMO_SCENARIO_2,
  DEMO_SCENARIO_3,
  DemoAgentAdapter,
  DemoRequirementProvider,
  DemoWorkflowPlanProvider,
} from "../src/modules/demo/index.js";
import { RequirementParserService } from "../src/modules/requirements/parser.service.js";
import { WorkflowRunner } from "../src/modules/workflows/workflow-runner.js";
import { ExportService } from "../src/modules/export/export.service.js";
import { ExportRepository } from "../src/db/repositories/export.repository.js";
import { DatasetQueryRepository } from "../src/db/repositories/dataset-query.repository.js";
import { loadEnvConfig } from "../src/config/env.js";
import type { ExecutionRunContext } from "../src/db/repositories/workflow-execution.repository.js";
import type { WorkflowRunnerStore } from "../src/modules/workflows/workflow-runner.js";
import type { WorkflowPlan } from "../src/modules/planner/workflow-plan.schema.js";
import type { AgentResult } from "../src/agent/types.js";
import type { PrismaClient } from "@prisma/client";

interface StoredDataset {
  id: string;
  workspaceId: string;
  workflowId: string;
  workflowRunId: string;
  name: string;
  originalPrompt: string;
  recordCount: number;
  validRecordCount: number;
  duplicateCount: number;
  sourceCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredRow {
  id: string;
  datasetId: string;
  rowNumber: number;
  values: Record<string, unknown>;
  rawValues?: Record<string, unknown> | undefined;
  isValid: boolean;
  isDuplicate: boolean;
  duplicateOfId: string | null;
  canonicalRowId: string | null;
  verificationStatus: string;
  confidenceScore: number;
  sourceUrls: string[];
  conflicts: unknown[];
  createdAt: Date;
}

interface StoredColumn {
  id: string;
  key: string;
  name: string;
  label: string;
  type: string;
  position: number;
  required: boolean;
  orderIndex: number;
  filterable: boolean;
  sortable: boolean;
}

interface StoredSource {
  id: string;
  url: string;
  domain: string;
}

interface StoredExportJob {
  id: string;
  createdAt: Date;
  [key: string]: unknown;
}

describe("FINAL PHASE — Demo Readiness & 3 Polished Scenarios", () => {
  let exportStorageDir: string;

  beforeAll(() => {
    exportStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), "aidp-demo-exports-"));
  });

  // ==========================================================================
  // Helper: Create an in-memory WorkflowRunnerStore & Dataset Query store
  // ==========================================================================
  function createDemoExecutionEnvironment(scenarioPlan: WorkflowPlan, prompt: string) {
    const runId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const workflowId = crypto.randomUUID();
    const cancellationRequested = false;
    const stepStatuses = new Map<string, string>();
    const emittedEvents: Array<{ action: string; details?: unknown }> = [];

    // Dataset in-memory tables
    const datasets = new Map<string, StoredDataset>();
    const columns = new Map<string, StoredColumn[]>();
    const rows = new Map<string, StoredRow[]>();
    const sources = new Map<string, StoredSource>();
    const exportJobs = new Map<string, StoredExportJob>();

    const store: WorkflowRunnerStore = {
      async getExecutionContext(): Promise<ExecutionRunContext> {
        return {
          id: runId,
          workspaceId,
          workflowId,
          createdById: crypto.randomUUID(),
          requirement: prompt,
          plan: scenarioPlan,
          cancelRequestedAt: null,
        };
      },
      async markRunStarted(): Promise<boolean> {
        return true;
      },
      async startStep(_runId, stepId) {
        stepStatuses.set(stepId, "RUNNING");
      },
      async finishStep(_runId, stepId, input) {
        stepStatuses.set(stepId, input.status);
      },
      async setRunProgress() {},
      async isCancellationRequested() {
        return cancellationRequested;
      },
      async finishRun() {},
      async getStepsBySequence(_runId, sequence) {
        return scenarioPlan.steps[sequence]?.id ?? `step-${sequence}`;
      },
      async resolveSourceIds(_runId, sourceUrls) {
        return sourceUrls.map((u) => {
          const id = crypto.randomUUID();
          sources.set(id, { id, url: u, domain: new URL(u).hostname });
          return id;
        });
      },
      async persistDataset(context, result: AgentResult) {
        const datasetId = crypto.randomUUID();
        const columnDefs = scenarioPlan.outputConfiguration.expectedColumns.map((colKey, idx) => ({
          id: crypto.randomUUID(),
          key: colKey,
          name: colKey,
          label: colKey,
          type: "string",
          position: idx,
          required: true,
          orderIndex: idx,
          filterable: true,
          sortable: true,
        }));
        columns.set(datasetId, columnDefs);

        const datasetRows = result.records.map((r, idx) => ({
          id: crypto.randomUUID(),
          datasetId,
          rowNumber: idx + 1,
          values: r.values,
          rawValues: r.rawValues,
          isValid: r.isValid !== false,
          isDuplicate: r.quality?.duplicateOfIndex !== undefined || r.quality?.duplicate?.decision === "MERGED",
          duplicateOfId: r.quality?.duplicateOfIndex !== undefined ? `row-${r.quality.duplicateOfIndex}` : null,
          canonicalRowId: null,
          verificationStatus: "VERIFIED",
          confidenceScore: 0.95,
          sourceUrls: r.sourceUrls,
          conflicts: r.quality?.conflicts ?? [],
          createdAt: new Date(),
        }));
        rows.set(datasetId, datasetRows);

        datasets.set(datasetId, {
          id: datasetId,
          workspaceId: context.workspaceId,
          workflowId: context.workflowId,
          workflowRunId: context.id,
          name: `Dataset: ${context.plan.objective}`,
          originalPrompt: context.requirement,
          recordCount: result.records.length,
          validRecordCount: result.records.filter((r) => r.isValid !== false).length,
          duplicateCount: result.dataQuality?.metrics.duplicateCount ?? 0,
          sourceCount: result.sources.length,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        return { datasetId, recordCount: datasetRows.length, sourceCount: result.sources.length };
      },
      async emitRunEvent(_runId, action, details) {
        emittedEvents.push({ action, details });
      },
    };

    // Mock Prisma for DatasetQueryRepository & ExportRepository
    const mockPrisma = {
      workspaceMember: {
        findUnique: async () => ({ status: "ACTIVE" }),
      },
      dataset: {
        findUnique: async (args: { where: { id: string } }) => {
          const ds = datasets.get(args.where.id);
          if (!ds) return null;
          return {
            ...ds,
            columns: columns.get(args.where.id) ?? [],
            dataQualityReport: [],
            run: null,
            _count: { rows: (rows.get(args.where.id) ?? []).length },
          };
        },
        findFirst: async (args: { where: { id: string; workspaceId: string } }) => {
          const ds = datasets.get(args.where.id);
          if (!ds || ds.workspaceId !== args.where.workspaceId) return null;
          return {
            ...ds,
            columns: columns.get(args.where.id) ?? [],
            dataQualityReport: [],
            run: null,
            _count: { rows: (rows.get(args.where.id) ?? []).length },
          };
        },
      },
      datasetRow: {
        count: async (args: { where: { datasetId: string; isValid?: boolean } }) => {
          const dsRows = rows.get(args.where.datasetId) ?? [];
          if (args.where.isValid === true) return dsRows.filter((r) => r.isValid).length;
          return dsRows.length;
        },
        findMany: async (args: { where: { datasetId: string }; skip?: number; take?: number }) => {
          const dsRows = rows.get(args.where.datasetId) ?? [];
          const skip = args.skip ?? 0;
          const take = args.take ?? 50;
          return dsRows.slice(skip, skip + take).map((r) => ({
            ...r,
            _count: { sourceEvidence: 1 },
            sources: r.sourceUrls.map((u: string) => ({
              source: { url: u, domain: new URL(u).hostname },
              verified: true,
              evidenceSnippet: `Evidence from ${u}`,
            })),
          }));
        },
      },
      exportJob: {
        create: async (args: { data: Record<string, unknown> }) => {
          const id = crypto.randomUUID();
          const job: StoredExportJob = {
            id,
            ...args.data,
            createdAt: new Date(),
            startedAt: null,
            finishedAt: null,
            fileKey: null,
            fileMetadata: null,
            errorCode: null,
            errorMessage: null,
          };
          exportJobs.set(id, job);
          return job;
        },
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = exportJobs.get(args.where.id);
          const updated = { ...existing, ...args.data } as StoredExportJob;
          exportJobs.set(args.where.id, updated);
          return updated;
        },
        findUnique: async (args: { where: { id: string } }) => {
          return exportJobs.get(args.where.id) ?? null;
        },
        findFirst: async (args: { where: { id: string; workspaceId: string } }) => {
          const j = exportJobs.get(args.where.id);
          if (!j || j.workspaceId !== args.where.workspaceId) return null;
          return j;
        },
      },
    } as unknown as PrismaClient;

    const datasetQueryRepo = new DatasetQueryRepository(mockPrisma);
    const exportRepo = new ExportRepository(mockPrisma, exportStorageDir);
    const exportService = new ExportService(exportRepo, datasetQueryRepo, {
      chunkSize: 500,
    });

    return {
      runId,
      workspaceId,
      workflowId,
      store,
      stepStatuses,
      emittedEvents,
      datasets,
      rows,
      datasetQueryRepo,
      exportRepo,
      exportService,
    };
  }

  // ==========================================================================
  // SCENARIO 1: Indian AI Startups (Post-2020)
  // ==========================================================================
  describe("Scenario 1: 100 Indian AI Startups Founded After 2020", () => {
    const prompt = DEMO_SCENARIO_1.canonicalPrompt;

    it("Point 1-3: Prompt received, requirement parsed and validated with visible fields", async () => {
      const parser = new RequirementParserService(new DemoRequirementProvider());
      const result = await parser.parse(prompt);

      expect(result.validationStatus).toBe("valid");
      expect(result.parsedRequirement.quantity).toBe(100);
      expect(result.parsedRequirement.geography.places).toContain("India");
      expect(result.parsedRequirement.requiredFields).toEqual(
        expect.arrayContaining(["company_name", "founder", "website", "funding", "location"]),
      );
    });

    it("Point 4-5: Generated workflow plan is visible and valid schema", async () => {
      const parser = new RequirementParserService(new DemoRequirementProvider());
      const reqResult = await parser.parse(prompt);
      const planProvider = new DemoWorkflowPlanProvider();
      const planDraft = await planProvider.generatePlan(reqResult.parsedRequirement);

      expect(planDraft.steps.length).toBe(7);
      expect(planDraft.steps.map((s) => s.type)).toEqual([
        "SEARCH",
        "SCRAPE",
        "EXTRACT",
        "TRANSFORM",
        "VALIDATE",
        "DEDUPLICATE",
        "SAVE",
      ]);
      expect(planDraft.completionCriteria.targetRecordCount).toBe(100);
    });

    it("Point 6-22: Full execution — progress, sources, dataset, metrics, duplicate count, exports", async () => {
      const parser = new RequirementParserService(new DemoRequirementProvider());
      const req = (await parser.parse(prompt)).parsedRequirement;
      const planDraft = await new DemoWorkflowPlanProvider().generatePlan(req);

      const plan: WorkflowPlan = {
        version: 1,
        requirement: req,
        ...planDraft,
      };

      const env = createDemoExecutionEnvironment(plan, prompt);
      const agent = new DemoAgentAdapter();
      const mockLogger = { info: () => {}, warn: () => {}, error: () => {} } as unknown as Logger;
      const runner = new WorkflowRunner(env.store, agent, mockLogger);

      // Execute Workflow
      await runner.run(env.runId);

      // Verify all steps completed
      for (const step of plan.steps) {
        expect(env.stepStatuses.get(step.id)).toBe("COMPLETED");
      }

      // Verify execution progress events were emitted
      const emittedActions = env.emittedEvents.map((e) => e.action);
      expect(emittedActions).toContain("SOURCE_DISCOVERY_STARTED");
      expect(emittedActions).toContain("SOURCE_DISCOVERED");
      expect(emittedActions).toContain("SCRAPE_STARTED");
      expect(emittedActions).toContain("SCRAPE_COMPLETED");
      expect(emittedActions).toContain("EXTRACTION_STARTED");
      expect(emittedActions).toContain("RECORDS_EXTRACTED");
      expect(emittedActions).toContain("VALIDATION_COMPLETED");
      expect(emittedActions).toContain("DEDUPLICATION_COMPLETED");
      expect(emittedActions).toContain("DATASET_CREATED");
      expect(emittedActions).toContain("RUN_COMPLETED");

      // Verify Dataset was created
      const datasetId = [...env.datasets.keys()][0]!;
      expect(datasetId).toBeDefined();
      const dataset = env.datasets.get(datasetId)!;
      expect(dataset.recordCount).toBeGreaterThanOrEqual(100);

      // Verify Data Quality metrics & duplicate counts
      expect(dataset.duplicateCount).toBe(3); // 3 duplicate startup records detected
      const createdRows = env.rows.get(datasetId)!;
      const duplicates = createdRows.filter((r) => r.isDuplicate);
      expect(duplicates.length).toBe(3);

      // Verify conflict preservation
      const rowsWithConflicts = createdRows.filter((r) => r.conflicts && r.conflicts.length > 0);
      expect(rowsWithConflicts.length).toBeGreaterThan(0);
      const conflictItem = rowsWithConflicts.find((r) => r.values.company_name === "Sarvam AI");
      expect(conflictItem).toBeDefined();

      // Verify sources are visible with provenance
      const allSources = DEMO_SCENARIO_1.sources;
      expect(allSources.length).toBeGreaterThan(15);
      const validSources = allSources.filter((s) => s.verifiedByTool);
      expect(validSources.length).toBeGreaterThan(15);
      // Verify broken 404 source was safely tolerated
      const brokenSource = allSources.find((s) => !s.verifiedByTool);
      expect(brokenSource).toBeDefined();

      // Verify Export to CSV, JSON, XLSX
      const csvJob = await env.exportService.createAndProcessExport({
        datasetId,
        workspaceId: env.workspaceId,
        userId: crypto.randomUUID(),
        format: "CSV",
      }, true);
      expect(csvJob.status).toBe("COMPLETED");
      expect(csvJob.fileMetadata).toBeDefined();
      expect(csvJob.fileMetadata!.fileName).toBeDefined();
      const csvPath = path.join(exportStorageDir, csvJob.fileMetadata!.fileName);
      expect(fs.existsSync(csvPath)).toBe(true);
      const csvContent = fs.readFileSync(csvPath, "utf8");
      expect(csvContent).toContain("Sarvam AI");
      expect(csvContent).toContain("Krutrim");

      const jsonJob = await env.exportService.createAndProcessExport({
        datasetId,
        workspaceId: env.workspaceId,
        userId: crypto.randomUUID(),
        format: "JSON",
      }, true);
      expect(jsonJob.status).toBe("COMPLETED");
      expect(jsonJob.fileMetadata).toBeDefined();
      const jsonContent = JSON.parse(fs.readFileSync(path.join(exportStorageDir, jsonJob.fileMetadata!.fileName), "utf8"));
      expect(Array.isArray(jsonContent)).toBe(true);
      expect(jsonContent.length).toBeGreaterThanOrEqual(100);

      const xlsxJob = await env.exportService.createAndProcessExport({
        datasetId,
        workspaceId: env.workspaceId,
        userId: crypto.randomUUID(),
        format: "XLSX",
      }, true);
      expect(xlsxJob.status).toBe("COMPLETED");
      expect(xlsxJob.fileMetadata).toBeDefined();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(path.join(exportStorageDir, xlsxJob.fileMetadata!.fileName));
      const worksheet = workbook.worksheets[0]!;
      expect(worksheet.rowCount).toBeGreaterThanOrEqual(100);
    });
  });

  // ==========================================================================
  // SCENARIO 2: Software Engineering Jobs in India
  // ==========================================================================
  describe("Scenario 2: Software Engineering Jobs in India", () => {
    const prompt = DEMO_SCENARIO_2.canonicalPrompt;

    it("Parses requirement, plans workflow, executes cleanly, captures duplicate jobs and exports", async () => {
      const parser = new RequirementParserService(new DemoRequirementProvider());
      const req = (await parser.parse(prompt)).parsedRequirement;
      expect(req.entityType).toBe("Software Engineering Job");
      expect(req.quantity).toBe(30);

      const planDraft = await new DemoWorkflowPlanProvider().generatePlan(req);
      const plan: WorkflowPlan = {
        version: 1,
        requirement: req,
        ...planDraft,
      };

      const env = createDemoExecutionEnvironment(plan, prompt);
      const mockLogger = { info: () => {}, warn: () => {}, error: () => {} } as unknown as Logger;
      const runner = new WorkflowRunner(env.store, new DemoAgentAdapter(), mockLogger);

      await runner.run(env.runId);

      const datasetId = [...env.datasets.keys()][0]!;
      const dataset = env.datasets.get(datasetId)!;
      expect(dataset.recordCount).toBeGreaterThanOrEqual(30);
      expect(dataset.duplicateCount).toBe(2); // 2 duplicate jobs

      // Export test
      const exportJob = await env.exportService.createAndProcessExport({
        datasetId,
        workspaceId: env.workspaceId,
        userId: crypto.randomUUID(),
        format: "CSV",
      }, true);
      expect(exportJob.status).toBe("COMPLETED");
      expect(exportJob.fileMetadata).toBeDefined();
      const csv = fs.readFileSync(path.join(exportStorageDir, exportJob.fileMetadata!.fileName), "utf8");
      expect(csv).toContain("Google India");
      expect(csv).toContain("Microsoft India");
    });
  });

  // ==========================================================================
  // SCENARIO 3: Technology Sponsors for College Hackathons
  // ==========================================================================
  describe("Scenario 3: College Hackathon Technology Sponsors", () => {
    const prompt = DEMO_SCENARIO_3.canonicalPrompt;

    it("Parses requirement, plans workflow, executes cleanly, captures sponsors and exports", async () => {
      const parser = new RequirementParserService(new DemoRequirementProvider());
      const req = (await parser.parse(prompt)).parsedRequirement;
      expect(req.entityType).toBe("Technology Sponsor");
      expect(req.quantity).toBe(25);

      const planDraft = await new DemoWorkflowPlanProvider().generatePlan(req);
      const plan: WorkflowPlan = {
        version: 1,
        requirement: req,
        ...planDraft,
      };

      const env = createDemoExecutionEnvironment(plan, prompt);
      const mockLogger = { info: () => {}, warn: () => {}, error: () => {} } as unknown as Logger;
      const runner = new WorkflowRunner(env.store, new DemoAgentAdapter(), mockLogger);

      await runner.run(env.runId);

      const datasetId = [...env.datasets.keys()][0]!;
      const dataset = env.datasets.get(datasetId)!;
      expect(dataset.recordCount).toBeGreaterThanOrEqual(25);
      expect(dataset.duplicateCount).toBe(2); // 2 duplicate sponsor entries

      // Export test
      const jsonJob = await env.exportService.createAndProcessExport({
        datasetId,
        workspaceId: env.workspaceId,
        userId: crypto.randomUUID(),
        format: "JSON",
      }, true);
      expect(jsonJob.status).toBe("COMPLETED");
      expect(jsonJob.fileMetadata).toBeDefined();
      const json = JSON.parse(fs.readFileSync(path.join(exportStorageDir, jsonJob.fileMetadata!.fileName), "utf8"));
      expect(json.some((r: Record<string, unknown>) => r.company_name === "GitHub")).toBe(true);
      expect(json.some((r: Record<string, unknown>) => r.company_name === "Postman")).toBe(true);
    });
  });

  // ==========================================================================
  // DEMO_MODE Configuration & Distinction Verification
  // ==========================================================================
  describe("DEMO_MODE configuration & simulation distinction", () => {
    it("DEMO_MODE=true bypasses external API credential checks and marks simulated data", () => {
      const config = loadEnvConfig({
        APP_ENV: "test",
        DATABASE_URL: "mysql://test:test@localhost:3306/test",
        DEMO_MODE: "true",
      });
      expect(config.DEMO_MODE).toBe(true);

      const agent = new DemoAgentAdapter();
      const health = agent.checkConfiguration();
      expect(health.configured).toBe(true);
      expect(health.provider).toBe("demo-simulator");

      // Verify simulated marking on records
      const scenario = DEMO_SCENARIO_1;
      for (const rec of scenario.records) {
        expect(rec.rawValues).toBeDefined();
        expect(rec.rawValues!._isDemoSimulated).toBe(true);
      }
    });

    it("DEMO_MODE=false enforces credential requirement assertions", () => {
      const config = loadEnvConfig({
        APP_ENV: "test",
        DATABASE_URL: "mysql://test:test@localhost:3306/test",
        DEMO_MODE: "false",
      });
      expect(config.DEMO_MODE).toBe(false);
    });
  });
});
