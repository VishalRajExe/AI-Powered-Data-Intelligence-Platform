import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Logger } from "pino";
import {
  ALL_DEMO_SCENARIOS,
  DEMO_SCENARIO_1,
  DEMO_SCENARIO_2,
  DEMO_SCENARIO_3,
  DemoAgentAdapter,
  DemoRequirementProvider,
  DemoWorkflowPlanProvider,
  type DemoScenarioDefinition,
} from "../modules/demo/index.js";
import { RequirementParserService } from "../modules/requirements/parser.service.js";
import { WorkflowRunner } from "../modules/workflows/workflow-runner.js";
import { ExportService } from "../modules/export/export.service.js";
import { ExportRepository } from "../db/repositories/export.repository.js";
import { DatasetQueryRepository } from "../db/repositories/dataset-query.repository.js";
import type { ExecutionRunContext } from "../db/repositories/workflow-execution.repository.js";
import type { WorkflowRunnerStore } from "../modules/workflows/workflow-runner.js";
import type { WorkflowPlan } from "../modules/planner/workflow-plan.schema.js";
import type { AgentResult } from "../agent/types.js";
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
  conflictCount: number;
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

interface StoredExportJob {
  id: string;
  createdAt: Date;
  [key: string]: unknown;
}

// Ensure demo exports folder exists
const demoExportsDir = path.resolve(process.cwd(), "demo-exports");
fs.mkdirSync(demoExportsDir, { recursive: true });

async function executeScenarioDemo(scenario: DemoScenarioDefinition): Promise<void> {
  console.log("\n" + "=".repeat(80));
  console.log(`🎯 DEMO SCENARIO ${scenario.scenarioNumber}: ${scenario.name.toUpperCase()}`);
  console.log("=".repeat(80));
  console.log(`[CONFIGURATION] DEMO_MODE=true | Deterministic judge demonstration`);
  console.log(`[DISCLAIMER]    Simulated records clearly marked. No live web scraping was performed.`);
  console.log(`[OBJECTIVE]     ${scenario.requirement.objective}\n`);

  // --------------------------------------------------------------------------
  // STEP 1: Natural Language Input & Requirement Analysis
  // --------------------------------------------------------------------------
  console.log(`\x1b[36m--- [STAGE 1] NATURAL LANGUAGE REQUIREMENT PARSING ---\x1b[0m`);
  console.log(`Prompt: "${scenario.canonicalPrompt}"`);
  const reqParser = new RequirementParserService(new DemoRequirementProvider());
  const parsed = await reqParser.parse(scenario.canonicalPrompt);
  const req = parsed.parsedRequirement;

  console.log(`Status:         ${parsed.validationStatus.toUpperCase()}`);
  console.log(`Entity Type:    ${req.entityType}`);
  console.log(`Target Count:   ${req.quantity}`);
  console.log(`Geography:      ${req.geography.places.join(", ")} (${req.geography.scope})`);
  console.log(`Required Fields:${req.requiredFields.join(", ")}`);
  console.log(`Preferred:      ${req.sourcePreferences.join(", ")}`);
  console.log(`Validation:     ${req.validationRules.map((r) => `${r.fieldKey}:${r.rule}`).join("; ")}`);

  // --------------------------------------------------------------------------
  // STEP 2: Autonomous Workflow Plan Generation
  // --------------------------------------------------------------------------
  console.log(`\n\x1b[36m--- [STAGE 2] AUTONOMOUS WORKFLOW PLAN GENERATION (DAG) ---\x1b[0m`);
  const planProvider = new DemoWorkflowPlanProvider();
  const planDraft = await planProvider.generatePlan(req);
  const plan: WorkflowPlan = {
    version: 1,
    requirement: req,
    ...planDraft,
  };

  console.log(`Generated Steps (${plan.steps.length}):`);
  for (const [idx, step] of plan.steps.entries()) {
    const deps = step.dependencies.length ? ` (depends on: ${step.dependencies.join(", ")})` : "";
    console.log(`  [Step ${idx + 1}] ${step.type.padEnd(12)} : ${step.description}${deps}`);
  }
  console.log(`Stop Condition:  Target ${plan.completionCriteria.targetRecordCount} records | Min Sources: ${plan.completionCriteria.minimumSources}`);

  // --------------------------------------------------------------------------
  // STEP 3: Execution, Step Progress & Provenance Collection
  // --------------------------------------------------------------------------
  console.log(`\n\x1b[36m--- [STAGE 3] PIPELINE EXECUTION & STEP PROGRESS ---\x1b[0m`);
  const runId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const workflowId = crypto.randomUUID();
  const stepStatuses = new Map<string, string>();
  const datasets = new Map<string, StoredDataset>();
  const columns = new Map<string, StoredColumn[]>();
  const rows = new Map<string, StoredRow[]>();
  const exportJobs = new Map<string, StoredExportJob>();

  const store: WorkflowRunnerStore = {
    async getExecutionContext(): Promise<ExecutionRunContext> {
      return {
        id: runId,
        workspaceId,
        workflowId,
        createdById: crypto.randomUUID(),
        requirement: scenario.canonicalPrompt,
        plan,
        cancelRequestedAt: null,
      };
    },
    async markRunStarted() { return true; },
    async startStep(_runId, stepId) {
      stepStatuses.set(stepId, "RUNNING");
      process.stdout.write(`  ⏳ Executing ${stepId.padEnd(24)}... `);
    },
    async finishStep(_runId, stepId, input) {
      stepStatuses.set(stepId, input.status);
      console.log(`\x1b[32m${input.status}\x1b[0m`);
    },
    async setRunProgress() {},
    async isCancellationRequested() { return false; },
    async finishRun() {},
    async getStepsBySequence(_runId, seq) { return plan.steps[seq]?.id ?? `step-${seq}`; },
    async resolveSourceIds(_runId, sourceUrls) { return sourceUrls.map(() => crypto.randomUUID()); },
    async persistDataset(context, result: AgentResult) {
      const datasetId = crypto.randomUUID();
      const colDefs = plan.outputConfiguration.expectedColumns.map((k, idx) => ({
        id: crypto.randomUUID(), key: k, name: k, label: k, type: "string", position: idx, required: true, orderIndex: idx, filterable: true, sortable: true,
      }));
      columns.set(datasetId, colDefs);

      const datasetRows: StoredRow[] = result.records.map((r, idx) => ({
        id: crypto.randomUUID(),
        datasetId,
        rowNumber: idx + 1,
        values: r.values,
        rawValues: r.rawValues,
        isValid: r.isValid !== false,
        isDuplicate: r.quality?.duplicateOfIndex !== undefined || r.quality?.duplicate?.decision === "MERGED",
        duplicateOfId: r.quality?.duplicateOfIndex !== undefined ? `row-${r.quality.duplicateOfIndex}` : null,
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
        conflictCount: result.dataQuality?.metrics.conflictCount ?? 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return { datasetId, recordCount: datasetRows.length, sourceCount: result.sources.length };
    },
  };

  const agent = new DemoAgentAdapter();
  const mockLogger = { info: () => {}, warn: () => {}, error: () => {} } as unknown as Logger;
  const runner = new WorkflowRunner(store, agent, mockLogger);
  await runner.run(runId);

  // --------------------------------------------------------------------------
  // STEP 4: Sources & Provenance Explorer
  // --------------------------------------------------------------------------
  console.log(`\n\x1b[36m--- [STAGE 4] SOURCES & PROVENANCE EXPLORER ---\x1b[0m`);
  const sources = scenario.sources;
  console.log(`Discovered Sources (${sources.length} total, ${sources.filter((s) => s.verifiedByTool).length} active):`);
  for (const s of sources.slice(0, 6)) {
    const badge = s.verifiedByTool ? "\x1b[32m[VERIFIED]\x1b[0m" : "\x1b[31m[404 TOLERATED]\x1b[0m";
    console.log(`  ${badge} ${s.domain.padEnd(20)} ${s.url}`);
    if (s.snippet) console.log(`      Snippet: ${s.snippet.slice(0, 90)}...`);
  }
  if (sources.length > 6) {
    console.log(`  ... and ${sources.length - 6} more supporting provenance sources.`);
  }

  // --------------------------------------------------------------------------
  // STEP 5: Dataset & Data Quality Inspection
  // --------------------------------------------------------------------------
  console.log(`\n\x1b[36m--- [STAGE 5] DATASET & DATA QUALITY METRICS ---\x1b[0m`);
  const datasetId = [...datasets.keys()][0]!;
  const datasetMeta = datasets.get(datasetId)!;
  const datasetRows = rows.get(datasetId)!;
  const canonicalRows = datasetRows.filter((r) => !r.isDuplicate && r.isValid);
  const conflictedRows = datasetRows.filter((r) => r.conflicts && r.conflicts.length > 0);

  console.log(`Dataset ID:       ${datasetId}`);
  console.log(`Total Extracted:  ${datasetMeta.recordCount} records`);
  console.log(`Valid Records:    ${datasetMeta.validRecordCount} records`);
  console.log(`Duplicate Count:  ${datasetMeta.duplicateCount} duplicates resolved`);
  console.log(`Conflicting Data: ${conflictedRows.length} entities with cross-source field discrepancies preserved`);
  console.log(`Active Sources:   ${datasetMeta.sourceCount} verified web sources`);

  // Preview sample table
  console.log(`\nSample Table Preview (first 5 canonical rows):`);
  const sampleCols = plan.outputConfiguration.expectedColumns.slice(0, 4);
  console.log("  " + sampleCols.map((c) => c.toUpperCase().padEnd(24)).join(" | "));
  console.log("  " + "-".repeat(sampleCols.length * 27));
  for (const r of canonicalRows.slice(0, 5)) {
    const line = sampleCols.map((c) => String(r.values[c] ?? "").slice(0, 22).padEnd(24)).join(" | ");
    console.log("  " + line);
  }

  // --------------------------------------------------------------------------
  // STEP 6: Multi-Format Data Export (CSV, JSON, XLSX)
  // --------------------------------------------------------------------------
  console.log(`\n\x1b[36m--- [STAGE 6] MULTI-FORMAT DATA EXPORT ---\x1b[0m`);
  const mockPrisma = {
    workspaceMember: { findUnique: async () => ({ status: "ACTIVE" }) },
    dataset: {
      findFirst: async () => ({
        ...datasetMeta,
        columns: columns.get(datasetId) ?? [],
        dataQualityReport: [],
        run: null,
        _count: { rows: datasetRows.length },
      }),
    },
    datasetRow: {
      count: async () => datasetRows.length,
      findMany: async (args: { skip?: number; take?: number }) => {
        const skip = args.skip ?? 0;
        const take = args.take ?? 50;
        return datasetRows.slice(skip, skip + take).map((r) => ({
          ...r,
          _count: { sourceEvidence: 1 },
          sources: r.sourceUrls.map((u: string) => ({ source: { url: u, domain: new URL(u).hostname } })),
        }));
      },
    },
    exportJob: {
      create: async (args: { data: Record<string, unknown> }) => {
        const id = crypto.randomUUID();
        const j = { id, ...args.data, createdAt: new Date() } as StoredExportJob;
        exportJobs.set(id, j);
        return j;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const prev = exportJobs.get(args.where.id) ?? { id: args.where.id, createdAt: new Date() };
        const next = { ...prev, ...args.data } as StoredExportJob;
        exportJobs.set(args.where.id, next);
        return next;
      },
      findFirst: async (args: { where: { id: string } }) => exportJobs.get(args.where.id) ?? null,
    },
  } as unknown as PrismaClient;

  const datasetQueryRepo = new DatasetQueryRepository(mockPrisma);
  const exportRepo = new ExportRepository(mockPrisma, demoExportsDir);
  const exportService = new ExportService(exportRepo, datasetQueryRepo, { chunkSize: 500 });

  for (const fmt of ["CSV", "JSON", "XLSX"] as const) {
    const job = await exportService.createAndProcessExport({
      datasetId,
      workspaceId,
      userId: crypto.randomUUID(),
      format: fmt,
    }, true);

    const filePath = path.join(demoExportsDir, job.fileMetadata!.fileName);
    const sizeKb = (fs.statSync(filePath).size / 1024).toFixed(1);
    console.log(`  \x1b[32m✓\x1b[0m ${fmt.padEnd(5)} exported -> ${path.relative(process.cwd(), filePath)} (${sizeKb} KB)`);
  }

  console.log(`\n\x1b[32m✔ Scenario ${scenario.scenarioNumber} demonstration completed successfully!\x1b[0m`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scenarioArg = args.find((a) => a.startsWith("--scenario="))?.split("=")[1]
    ?? (args.includes("--scenario") ? args[args.indexOf("--scenario") + 1] : undefined);
  const runAll = args.includes("--all");

  console.log("================================================================================");
  console.log("  AI-POWERED DATA INTELLIGENCE PLATFORM — POLISHED JUDGE DEMONSTRATIONS");
  console.log("================================================================================");

  if (runAll) {
    for (const sc of ALL_DEMO_SCENARIOS) {
      await executeScenarioDemo(sc);
    }
  } else if (scenarioArg === "2") {
    await executeScenarioDemo(DEMO_SCENARIO_2);
  } else if (scenarioArg === "3") {
    await executeScenarioDemo(DEMO_SCENARIO_3);
  } else {
    // Default Scenario 1
    await executeScenarioDemo(DEMO_SCENARIO_1);
    console.log("\nTIP: Run other scenarios using:");
    console.log("  npm run demo -- --scenario 2");
    console.log("  npm run demo -- --scenario 3");
    console.log("  npm run demo -- --all");
  }
}

main().catch((err) => {
  console.error("Demo run error:", err);
  process.exit(1);
});
