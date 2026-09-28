import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../common/errors.js";
import type { WorkflowPlan } from "../../modules/planner/workflow-plan.schema.js";
import { WorkflowPlanSchema } from "../../modules/planner/workflow-plan.schema.js";
import type { AgentResult } from "../../agent/types.js";
import { SourceValidator } from "../../modules/sources/SourceValidator.js";
import { DatasetRepository } from "./dataset.repository.js";

export interface WorkflowExecutionStore {
  createRun(input: { workspaceId: string; createdById: string; workflowId: string; planVersion?: number }): Promise<{ id: string }>;
  completeRun(runId: string, result: AgentResult): Promise<void>;
}

export interface ExecutionRunContext {
  id: string;
  workspaceId: string;
  workflowId: string;
  createdById: string;
  requirement: string;
  plan: WorkflowPlan;
  cancelRequestedAt: Date | null;
}

export class WorkflowExecutionRepository implements WorkflowExecutionStore {
  private readonly sourceValidator = new SourceValidator();
  private readonly datasetRepository: DatasetRepository;
  constructor(private readonly prisma: PrismaClient) { this.datasetRepository = new DatasetRepository(prisma); }

  async createRun(input: { workspaceId: string; createdById: string; workflowId: string; planVersion?: number }): Promise<{ id: string }> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.createdById } },
      select: { status: true },
    });
    if (membership?.status !== "ACTIVE") throw new AppError("Active workspace membership is required", 403, "WORKSPACE_ACCESS_DENIED");

    const workflow = await this.prisma.workflow.findFirst({
      where: { id: input.workflowId, workspaceId: input.workspaceId, planningStatus: "PLANNED" },
      select: { id: true, requirement: true, plans: { orderBy: { version: "desc" }, take: 1 } },
    });
    const planRecord = workflow?.plans[0];
    if (!workflow || !planRecord || (input.planVersion && planRecord.version !== input.planVersion)) {
      throw new AppError("A persisted workflow plan was not found", 404, "WORKFLOW_PLAN_NOT_FOUND");
    }
    const parsedPlan = WorkflowPlanSchema.safeParse({
      version: planRecord.version,
      objective: planRecord.objective,
      requirement: planRecord.requirement,
      constraints: planRecord.constraints,
      sourcePolicy: planRecord.sourcePolicy,
      searchStrategy: planRecord.searchStrategy,
      steps: planRecord.steps,
      extractionSchema: planRecord.extractionSchema,
      transformations: planRecord.transformations,
      validationRules: planRecord.validationRules,
      deduplicationRules: planRecord.deduplicationRules,
      completionCriteria: planRecord.completionCriteria,
      outputConfiguration: planRecord.outputConfiguration,
    });
    if (!parsedPlan.success) throw new AppError("Persisted workflow plan failed validation", 409, "WORKFLOW_PLAN_INVALID");

    return this.prisma.$transaction(async (tx) => {
      const run = await tx.workflowRun.create({ data: {
        workspaceId: input.workspaceId, workflowId: input.workflowId, workflowPlanId: planRecord.id, status: "PENDING",
      }, select: { id: true } });
      await tx.workflowStep.createMany({ data: parsedPlan.data.steps.map((step, sequence) => ({
        workspaceId: input.workspaceId,
        workflowRunId: run.id,
        sequence,
        type: step.type,
        status: "PENDING",
        input: asJson({ id: step.id, description: step.description, input: step.input, configuration: step.configuration, dependencies: step.dependencies, retryPolicy: step.retryPolicy, timeoutMs: step.timeoutMs, expectedOutput: step.expectedOutput }),
      })) });
      await tx.activityEvent.create({ data: {
        workspaceId: input.workspaceId, actorId: input.createdById, action: "workflow_run.queued",
        entityType: "workflow_run", entityId: run.id, details: { workflowId: input.workflowId },
      } });
      return run;
    });
  }

  async getExecutionContext(runId: string): Promise<ExecutionRunContext> {
    const run = await this.prisma.workflowRun.findUnique({
      where: { id: runId },
      include: { workflow: { select: { requirement: true, createdById: true } }, plan: true },
    });
    if (!run) throw new AppError("Workflow run was not found", 404, "WORKFLOW_RUN_NOT_FOUND");
    const plan = WorkflowPlanSchema.safeParse({
      version: run.plan.version, objective: run.plan.objective, requirement: run.plan.requirement,
      constraints: run.plan.constraints, sourcePolicy: run.plan.sourcePolicy, searchStrategy: run.plan.searchStrategy,
      steps: run.plan.steps, extractionSchema: run.plan.extractionSchema, transformations: run.plan.transformations,
      validationRules: run.plan.validationRules, deduplicationRules: run.plan.deduplicationRules,
      completionCriteria: run.plan.completionCriteria, outputConfiguration: run.plan.outputConfiguration,
    });
    if (!plan.success) throw new AppError("Persisted workflow plan failed validation", 409, "WORKFLOW_PLAN_INVALID");
    return { id: run.id, workspaceId: run.workspaceId, workflowId: run.workflowId, createdById: run.workflow.createdById,
      requirement: run.workflow.requirement, plan: plan.data, cancelRequestedAt: run.cancelRequestedAt };
  }

  async markRunStarted(runId: string): Promise<boolean> {
    const result = await this.prisma.workflowRun.updateMany({ where: { id: runId, status: "PENDING", cancelRequestedAt: null }, data: { status: "RUNNING", startedAt: new Date(), attempt: { increment: 1 } } });
    if (result.count === 1) await this.event(runId, "workflow_run.started", {});
    return result.count === 1;
  }

  async startStep(runId: string, stepId: string, retryCount: number): Promise<void> {
    await this.prisma.workflowStep.update({ where: { id: stepId }, data: { status: "RUNNING", attempt: { increment: 1 }, retryCount, startedAt: new Date(), finishedAt: null, durationMs: null, errorCode: null, errorMessage: null } });
    await this.event(runId, "workflow_step.started", { stepId, retryCount });
  }

  async finishStep(runId: string, stepId: string, input: { status: "COMPLETED" | "FAILED" | "SKIPPED" | "BLOCKED" | "CANCELLED"; startedAt: Date; output?: unknown; errorCode?: string; errorMessage?: string; sourceIds?: string[]; retryCount: number }): Promise<void> {
    await this.prisma.workflowStep.update({ where: { id: stepId }, data: {
      status: input.status, finishedAt: new Date(), durationMs: Math.max(0, Date.now() - input.startedAt.getTime()), retryCount: input.retryCount,
      ...(input.output === undefined ? {} : { outputSummary: asJson(input.output) }),
      ...(input.sourceIds === undefined ? {} : { sourceIds: asJson(input.sourceIds) }),
      errorCode: input.errorCode ?? null, errorMessage: input.errorMessage?.slice(0, 1000) ?? null,
    } });
    await this.event(runId, `workflow_step.${input.status.toLowerCase()}`, { stepId, retryCount: input.retryCount, errorCode: input.errorCode });
  }

  async setRunProgress(runId: string, progress: number): Promise<void> {
    await this.prisma.workflowRun.update({ where: { id: runId }, data: { progress: Math.max(0, Math.min(99, Math.floor(progress))) } });
  }

  async isCancellationRequested(runId: string): Promise<boolean> {
    const run = await this.prisma.workflowRun.findUnique({ where: { id: runId }, select: { cancelRequestedAt: true, status: true } });
    return !run || run.status === "CANCELLED" || run.cancelRequestedAt !== null;
  }

  async finishRun(runId: string, status: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED", error?: { code: string; message: string }, counts?: { records: number; sources: number; duplicates?: number }): Promise<void> {
    await this.prisma.workflowRun.update({ where: { id: runId }, data: {
      status, ...(status === "COMPLETED" ? { progress: 100 } : {}),
      ...(counts ? { recordsFound: counts.records, recordsValid: counts.records, sourcesProcessed: counts.sources, ...(counts.duplicates === undefined ? {} : { duplicateCount: counts.duplicates }) } : {}),
      errorCode: error?.code ?? null, errorMessage: error?.message.slice(0, 1000) ?? null, finishedAt: new Date(),
    } });
    await this.event(runId, `workflow_run.${status.toLowerCase()}`, { status, ...counts, errorCode: error?.code });
  }

  async completeRun(runId: string, result: AgentResult): Promise<void> {
    const status = result.status === "COMPLETED" ? "COMPLETED" : result.status === "PARTIAL" ? "PARTIAL" : "FAILED";
    await this.finishRun(runId, status, result.errors[0] ? { code: result.errors[0].code, message: result.errors[0].message } : undefined,
      { records: result.records.length, sources: result.sources.filter(({ verifiedByTool }) => verifiedByTool).length });
  }

  async failRun(runId: string, error: { code: string; message: string }): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const run = await tx.workflowRun.findUnique({ where: { id: runId }, select: { workspaceId: true, status: true } });
      if (!run || !["PENDING", "PLANNING", "RUNNING"].includes(run.status)) return;
      await tx.workflowStep.updateMany({ where: { workflowRunId: runId, status: { in: ["PENDING", "RUNNING"] } }, data: {
        status: "FAILED", finishedAt: now, durationMs: 0, errorCode: error.code.slice(0, 100), errorMessage: error.message.slice(0, 1000),
      } });
      await tx.workflowRun.updateMany({ where: { id: runId, status: { in: ["PENDING", "PLANNING", "RUNNING"] } }, data: { status: "FAILED", errorCode: error.code.slice(0, 100), errorMessage: error.message.slice(0, 1000), finishedAt: now } });
      await tx.activityEvent.create({ data: { workspaceId: run.workspaceId, action: "workflow_run.failed", entityType: "workflow_run", entityId: runId, details: { errorCode: error.code } } });
    });
  }

  async requestCancellation(runId: string, workspaceId: string, userId: string): Promise<{ status: string; queued: boolean }> {
    const membership = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, select: { status: true } });
    if (membership?.status !== "ACTIVE") throw new AppError("Active workspace membership is required", 403, "WORKSPACE_ACCESS_DENIED");
    const run = await this.prisma.workflowRun.findFirst({ where: { id: runId, workspaceId } });
    if (!run) throw new AppError("Workflow run was not found", 404, "WORKFLOW_RUN_NOT_FOUND");
    const updated = await this.prisma.workflowRun.updateMany({ where: { id: runId, workspaceId, status: { in: ["PENDING", "PLANNING", "RUNNING"] }, cancelRequestedAt: null }, data: { cancelRequestedAt: new Date() } });
    if (updated.count === 0) {
      const current = await this.prisma.workflowRun.findUnique({ where: { id: runId }, select: { status: true } });
      return { status: current?.status ?? run.status, queued: false };
    }
    await this.event(runId, "workflow_run.cancel_requested", { requestedById: userId });
    return { status: run.status, queued: true };
  }

  async getRun(runId: string, workspaceId: string, userId: string) {
    await this.assertAccess(workspaceId, userId);
    const run = await this.prisma.workflowRun.findFirst({ where: { id: runId, workspaceId }, include: { steps: { orderBy: { sequence: "asc" } } } });
    if (!run) throw new AppError("Workflow run was not found", 404, "WORKFLOW_RUN_NOT_FOUND");
    return run;
  }

  async getSteps(runId: string, workspaceId: string, userId: string) {
    await this.assertAccess(workspaceId, userId);
    const run = await this.prisma.workflowRun.findFirst({ where: { id: runId, workspaceId }, select: { id: true } });
    if (!run) throw new AppError("Workflow run was not found", 404, "WORKFLOW_RUN_NOT_FOUND");
    return this.prisma.workflowStep.findMany({ where: { workflowRunId: runId, workspaceId }, orderBy: { sequence: "asc" } });
  }

  async getStepsBySequence(runId: string, sequence: number): Promise<string> {
    const step = await this.prisma.workflowStep.findUnique({ where: { workflowRunId_sequence: { workflowRunId: runId, sequence } }, select: { id: true } });
    if (!step) throw new AppError("Workflow step was not found", 404, "WORKFLOW_STEP_NOT_FOUND");
    return step.id;
  }

  async resolveSourceIds(runId: string, sourceUrls: string[]): Promise<string[]> {
    if (!sourceUrls.length) return [];
    const hashes = sourceUrls.map((url) => this.sourceValidator.normalize(url)).filter((value): value is { canonicalUrl: string; domain: string; hash: string } => "hash" in value).map(({ hash }) => hash);
    if (!hashes.length) return [];
    const rows = await this.prisma.source.findMany({ where: { workflowRunId: runId, canonicalUrlHash: { in: hashes } }, select: { id: true } });
    return rows.map(({ id }) => id);
  }

  async persistDataset(context: ExecutionRunContext, result: AgentResult): Promise<{ datasetId: string; recordCount: number; sourceCount: number }> {
    const existing = await this.prisma.dataset.findUnique({ where: { workflowRunId: context.id }, select: { id: true, recordCount: true, sourceCount: true } });
    if (existing) return { datasetId: existing.id, recordCount: existing.recordCount, sourceCount: existing.sourceCount };
    const sourceHashes = result.sources.filter((source) => source.verifiedByTool).map((source) => this.sourceValidator.normalize(source.url)).filter((value): value is { canonicalUrl: string; domain: string; hash: string } => "hash" in value).map(({ hash }) => hash);
    const sourceRows = await this.prisma.source.findMany({ where: {
      workspaceId: context.workspaceId, workflowRunId: context.id, status: { in: ["COLLECTED", "FETCHED"] }, canonicalUrlHash: { in: sourceHashes },
    }, select: { id: true, canonicalUrlHash: true, retrievedAt: true } });
    const sourceByHash = new Map(sourceRows.map((source) => [source.canonicalUrlHash, source]));
    const sourceHashByUrl = new Map(result.sources.filter((source) => source.verifiedByTool).flatMap((source) => {
      const normalized = this.sourceValidator.normalize(source.url);
      return "hash" in normalized ? [[source.canonicalUrl, normalized.hash] as const, [source.url, normalized.hash] as const] : [];
    }));
    const dataset = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dataset.create({ data: {
        workspaceId: context.workspaceId, workflowRunId: context.id, createdById: context.createdById,
        name: context.plan.objective.slice(0, 200), status: "BUILDING",
      } });
      await Promise.all(Object.entries(context.plan.extractionSchema.properties).map(([key, property], position) => tx.datasetColumn.create({ data: {
        workspaceId: context.workspaceId, datasetId: created.id, key, label: property.description.slice(0, 160),
        type: columnType(property.type, property.format), position, required: context.plan.extractionSchema.required.includes(key),
      } })));
      return created;
    });
    let inserted = 0;
    let validInserted = 0;
    try {
      for (const record of result.records) {
        const evidenceSources = record.sourceUrls.map((url) => sourceByHash.get(sourceHashByUrl.get(url) ?? "")).filter((source): source is NonNullable<typeof source> => Boolean(source));
        if (!evidenceSources.length) continue;
        const retrievedAt = evidenceSources.reduce((latest, source) => !latest || (source.retrievedAt && source.retrievedAt > latest) ? source.retrievedAt : latest, null as Date | null) ?? new Date();
        const row = await this.datasetRepository.insertRowWithEvidence({
          workspaceId: context.workspaceId, datasetId: dataset.id, values: asJson(record.values), isValid: record.isValid ?? true, collectedAt: retrievedAt,
          evidence: evidenceSources.map((source) => ({ sourceId: source.id, retrievedAt: source.retrievedAt ?? retrievedAt })),
        });
        if (record.validationIssues?.length) await this.prisma.validationIssue.createMany({ data: record.validationIssues.map((issue) => ({
          workspaceId: context.workspaceId, datasetId: dataset.id, datasetRowId: row.id, fieldKey: issue.fieldKey ?? null,
          ruleCode: issue.ruleCode, severity: issue.severity, message: issue.message,
        })) });
        inserted += 1;
        if (record.isValid !== false) validInserted += 1;
      }
    } catch (error) {
      await this.prisma.dataset.update({ where: { id: dataset.id }, data: { status: inserted ? "PARTIAL" : "FAILED", sourceCount: sourceRows.length } });
      throw error;
    }
    const status = inserted === result.records.length ? "READY" : inserted > 0 ? "PARTIAL" : "FAILED";
    await this.prisma.dataset.update({ where: { id: dataset.id }, data: { status, recordCount: inserted, validCount: validInserted, sourceCount: sourceRows.length } });
    if (inserted === 0 && result.records.length > 0) throw new AppError("No verified source evidence could be linked to the extracted records", 422, "SOURCE_EVIDENCE_REQUIRED");
    return { datasetId: dataset.id, recordCount: inserted, sourceCount: sourceRows.length };
  }

  private async assertAccess(workspaceId: string, userId: string): Promise<void> {
    const membership = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, select: { status: true } });
    if (membership?.status !== "ACTIVE") throw new AppError("Active workspace membership is required", 403, "WORKSPACE_ACCESS_DENIED");
  }

  private async event(runId: string, action: string, details: Record<string, unknown>): Promise<void> {
    const run = await this.prisma.workflowRun.findUnique({ where: { id: runId }, select: { workspaceId: true } });
    if (run) await this.prisma.activityEvent.create({ data: { workspaceId: run.workspaceId, action, entityType: "workflow_run", entityId: runId, details: asJson(details) } });
  }
}

function asJson(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
function columnType(type: string, format?: string): "STRING" | "NUMBER" | "BOOLEAN" | "DATE" | "DATETIME" | "URL" | "EMAIL" | "JSON" {
  if (format === "uri") return "URL";
  if (format === "email") return "EMAIL";
  if (format === "date") return "DATE";
  if (format === "date-time") return "DATETIME";
  if (type === "number" || type === "integer") return "NUMBER";
  if (type === "boolean") return "BOOLEAN";
  if (type === "array" || type === "object") return "JSON";
  return "STRING";
}
