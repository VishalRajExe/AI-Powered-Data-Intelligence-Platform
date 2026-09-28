import type { Logger } from "pino";
import type { AgentAdapter, AgentResult } from "../../agent/types.js";
import type { ExecutionRunContext } from "../../db/repositories/workflow-execution.repository.js";
import type { WorkflowStep } from "../planner/workflow-plan.schema.js";
import { DataQualityService } from "../data-intelligence/DataQualityService.js";
import { ActivityActions } from "../monitoring/monitoring.types.js";

export interface WorkflowRunnerStore {
  getExecutionContext(runId: string): Promise<ExecutionRunContext>;
  markRunStarted(runId: string): Promise<boolean>;
  startStep(runId: string, stepId: string, retryCount: number): Promise<void>;
  finishStep(runId: string, stepId: string, input: { status: "COMPLETED" | "FAILED" | "SKIPPED" | "BLOCKED" | "CANCELLED"; startedAt: Date; output?: unknown; errorCode?: string; errorMessage?: string; sourceIds?: string[]; retryCount: number }): Promise<void>;
  setRunProgress(runId: string, progress: number): Promise<void>;
  isCancellationRequested(runId: string): Promise<boolean>;
  finishRun(runId: string, status: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED", error?: { code: string; message: string }, counts?: { records: number; validRecords?: number; sources: number; duplicates?: number }): Promise<void>;
  getStepsBySequence(runId: string, sequence: number): Promise<string>;
  resolveSourceIds(runId: string, sourceUrls: string[]): Promise<string[]>;
  persistDataset(context: ExecutionRunContext, result: AgentResult): Promise<{ datasetId: string; recordCount: number; sourceCount: number }>;
  emitRunEvent?(runId: string, action: string, details?: Record<string, unknown>): Promise<void>;
}

type StepStatus = "COMPLETED" | "FAILED" | "SKIPPED" | "BLOCKED" | "CANCELLED";

/** Executes a persisted, schema-validated plan in dependency order; parallel execution is intentionally disabled. */
export class WorkflowRunner {
  constructor(
    private readonly store: WorkflowRunnerStore,
    private readonly agent: AgentAdapter,
    private readonly logger: Logger,
    private readonly dataQuality = new DataQualityService(),
  ) {}

  async run(runId: string): Promise<void> {
    const context = await this.store.getExecutionContext(runId);
    if (await this.store.isCancellationRequested(runId)) {
      await this.cancelRemaining(context, new Map());
      await this.store.finishRun(runId, "CANCELLED");
      return;
    }
    if (!await this.store.markRunStarted(runId)) {
      if (await this.store.isCancellationRequested(runId)) {
        await this.cancelRemaining(context, new Map());
        await this.store.finishRun(runId, "CANCELLED");
      }
      return;
    }
    const completed = new Map<string, StepStatus>();
    let finalResult: AgentResult | undefined;
    let failed = false;
    let skipped = false;
    let partialResult = false;
    let cancelled = false;

    let createdDatasetId: string | undefined;

    for (const [index, step] of context.plan.steps.entries()) {
      if (await this.store.isCancellationRequested(runId)) { cancelled = true; break; }
      const unmet = step.dependencies.filter((id) => completed.get(id) !== "COMPLETED");
      if (unmet.length) {
        completed.set(step.id, "SKIPPED");
        await this.store.finishStep(runId, await this.stepDatabaseId(runId, index), { status: "SKIPPED", startedAt: new Date(), retryCount: 0, errorCode: "DEPENDENCY_NOT_COMPLETED", errorMessage: `Skipped because prerequisite steps did not complete: ${unmet.join(", ")}` });
        await this.store.setRunProgress(runId, ((index + 1) / context.plan.steps.length) * 100);
        continue;
      }
      const result = await this.executeStep(context, step, index, runId, finalResult);
      completed.set(step.id, result.status);
      if (step.type === "SAVE" && result.output && typeof result.output === "object" && "datasetId" in result.output) {
        createdDatasetId = (result.output as { datasetId: string }).datasetId;
      }
      if (result.agentResult) finalResult = isAgentStep(step.type) ? mergeResults(finalResult, result.agentResult) : result.agentResult;
      if (result.agentResult?.status === "PARTIAL") partialResult = true;
      if (result.status === "FAILED" || result.status === "BLOCKED") failed = true;
      if (result.status === "SKIPPED") skipped = true;
      if (result.status === "CANCELLED") { cancelled = true; break; }
      await this.store.setRunProgress(runId, ((index + 1) / context.plan.steps.length) * 100);
    }

    if (cancelled || await this.store.isCancellationRequested(runId)) {
      await this.cancelRemaining(context, completed);
      await this.store.finishRun(runId, "CANCELLED", undefined, { records: finalResult?.records.length ?? 0, sources: finalResult?.sources.length ?? 0 });
      await this.store.emitRunEvent?.(runId, ActivityActions.RUN_CANCELLED, { status: "CANCELLED" });
    } else if (failed) {
      const partial = (finalResult?.records.length ?? 0) > 0;
      await this.store.finishRun(runId, partial ? "PARTIAL" : "FAILED", { code: "WORKFLOW_STEP_FAILED", message: "One or more workflow steps failed; inspect step errors for details." }, runCounts(finalResult));
      await this.store.emitRunEvent?.(runId, ActivityActions.RUN_FAILED, { status: partial ? "PARTIAL" : "FAILED", errorCode: "WORKFLOW_STEP_FAILED" });
    } else if (skipped) {
      const counts = runCounts(finalResult);
      await this.store.finishRun(runId, "PARTIAL", { code: "WORKFLOW_STEPS_SKIPPED", message: "One or more planned steps were skipped; inspect step details for reasons." }, counts);
      await this.store.emitRunEvent?.(runId, ActivityActions.RUN_COMPLETED, { status: "PARTIAL", datasetId: createdDatasetId, ...counts, recordsFound: counts.records, recordsValid: counts.validRecords, duplicateCount: counts.duplicates, sourcesProcessed: counts.sources });
    } else if (partialResult) {
      const firstError = finalResult?.errors[0];
      const counts = runCounts(finalResult);
      await this.store.finishRun(runId, "PARTIAL", firstError ? { code: firstError.code, message: firstError.message } : { code: "AGENT_PARTIAL_RESULT", message: "The agent returned incomplete results; inspect source and step details." }, counts);
      await this.store.emitRunEvent?.(runId, ActivityActions.RUN_COMPLETED, { status: "PARTIAL", datasetId: createdDatasetId, ...counts, recordsFound: counts.records, recordsValid: counts.validRecords, duplicateCount: counts.duplicates, sourcesProcessed: counts.sources });
    } else {
      const counts = runCounts(finalResult);
      await this.store.finishRun(runId, "COMPLETED", undefined, counts);
      await this.store.emitRunEvent?.(runId, ActivityActions.RUN_COMPLETED, { status: "COMPLETED", datasetId: createdDatasetId, ...counts, recordsFound: counts.records, recordsValid: counts.validRecords, duplicateCount: counts.duplicates, sourcesProcessed: counts.sources });
    }
  }

  private async executeStep(context: ExecutionRunContext, step: WorkflowStep, index: number, runId: string, priorResult?: AgentResult): Promise<{ status: StepStatus; agentResult?: AgentResult; output?: unknown }> {
    const stepRowId = await this.stepDatabaseId(runId, index);
    const maxRetries = step.retryPolicy.maxAttempts - 1;
    let retryCount = 0;
    let lastError: unknown;
    while (retryCount <= maxRetries) {
      if (await this.store.isCancellationRequested(runId)) {
        await this.store.finishStep(runId, stepRowId, { status: "CANCELLED", startedAt: new Date(), retryCount });
        return { status: "CANCELLED" };
      }
      const startedAt = new Date();
      await this.store.startStep(runId, stepRowId, retryCount);
      if (step.type === "SEARCH") {
        await this.store.emitRunEvent?.(runId, ActivityActions.SOURCE_DISCOVERY_STARTED, { stepId: step.id, stepType: step.type });
      } else if (step.type === "SCRAPE") {
        await this.store.emitRunEvent?.(runId, ActivityActions.SCRAPE_STARTED, { stepId: step.id, stepType: step.type });
      } else if (step.type === "EXTRACT") {
        await this.store.emitRunEvent?.(runId, ActivityActions.EXTRACTION_STARTED, { stepId: step.id, stepType: step.type });
      }
      try {
        let output: unknown = { accepted: true, stepType: step.type };
        let agentResult: AgentResult | undefined;
        if (["TRANSFORM", "VALIDATE", "DEDUPLICATE", "MERGE", "SAVE"].includes(step.type) && !priorResult?.records.length) {
          throw Object.assign(new Error(`Step ${step.type} has no output from a completed extraction step.`), { code: "STEP_INPUT_MISSING", retryable: false });
        }
        if (isAgentStep(step.type)) {
          agentResult = await this.agent.execute({ prompt: context.requirement, plan: context.plan, workspaceId: context.workspaceId, runId, stepType: step.type,
            ...(priorResult ? { sourceUrls: priorResult.sources.map((source) => source.canonicalUrl), priorRecords: priorResult.records } : {}) });
          if (await this.store.isCancellationRequested(runId)) throw Object.assign(new Error("Workflow run cancellation was requested."), { code: "RUN_CANCELLED", retryable: false });
          if (agentResult.status === "FAILED") throw Object.assign(new Error("Collection step failed"), { code: agentResult.errors[0]?.code ?? "AGENT_STEP_FAILED", retryable: agentResult.errors[0]?.retryable ?? false });
          output = { recordCount: agentResult.records.length, sourceCount: agentResult.sources.length, toolCallCount: agentResult.execution.toolCallCount, toolsUsed: agentResult.execution.toolsUsed };
        }
        if (step.type === "TRANSFORM" && priorResult) {
          agentResult = this.dataQuality.normalize(priorResult, context.plan);
          output = { recordCount: agentResult.records.length, transformationCount: context.plan.transformations.length, normalized: true };
        } else if (step.type === "VALIDATE" && priorResult) {
          const validated = this.dataQuality.validate(priorResult, context.plan);
          agentResult = validated.result;
          const validRecordCount = agentResult.records.filter((r) => r.isValid !== false).length;
          output = {
            recordCount: agentResult.records.length,
            validRecordCount,
            validCount: validRecordCount,
            validationRules: context.plan.validationRules.length,
            issueCount: validated.issueCount,
            invalidRecordCount: validated.invalidRecordCount,
          };
        } else if (step.type === "DEDUPLICATE" && priorResult) {
          const deduplicated = this.dataQuality.deduplicate(priorResult, context.plan);
          agentResult = deduplicated.result;
          output = {
            recordCount: agentResult.records.length,
            duplicateCount: deduplicated.duplicateCount,
            duplicates: deduplicated.duplicateCount,
            conflictCount: deduplicated.conflictCount,
            decisions: deduplicated.events.length,
          };
        } else if (step.type === "MERGE" && priorResult) {
          agentResult = this.dataQuality.process(priorResult, context.plan);
          output = { recordCount: agentResult.records.length, provenanceSources: agentResult.sources.length, ...(agentResult.dataQuality?.metrics ?? {}) };
        } else if (step.type === "SAVE") {
          if (!priorResult?.records.length) throw Object.assign(new Error("No extracted records are available to save."), { code: "NO_RECORDS_TO_SAVE", retryable: false });
          agentResult = this.dataQuality.process(priorResult, context.plan);
          const saved = await this.store.persistDataset(context, agentResult);
          output = { ...saved, ...(agentResult.dataQuality?.metrics ?? {}) };
        } else if (step.type === "EXPORT") {
          await this.store.finishStep(runId, stepRowId, { status: "SKIPPED", startedAt, retryCount, errorCode: "EXPORT_NOT_IN_PHASE", errorMessage: "Export execution is provided by the exports phase." });
          return { status: "SKIPPED" };
        }
        if (step.type === "SEARCH") {
          await this.store.emitRunEvent?.(runId, ActivityActions.SOURCE_DISCOVERED, {
            stepId: step.id,
            sourceCount: agentResult?.sources.length ?? 0,
            sources: agentResult?.sources.map((s) => s.url) ?? [],
          });
        } else if (step.type === "SCRAPE") {
          await this.store.emitRunEvent?.(runId, ActivityActions.SCRAPE_COMPLETED, {
            stepId: step.id,
            sourceCount: agentResult?.sources.length ?? 0,
            recordCount: agentResult?.records.length ?? 0,
          });
        } else if (step.type === "EXTRACT") {
          await this.store.emitRunEvent?.(runId, ActivityActions.RECORDS_EXTRACTED, {
            stepId: step.id,
            recordCount: agentResult?.records.length ?? 0,
          });
        } else if (step.type === "VALIDATE") {
          await this.store.emitRunEvent?.(runId, ActivityActions.VALIDATION_COMPLETED, {
            stepId: step.id,
            ...(typeof output === "object" && output !== null ? output as Record<string, unknown> : {}),
          });
        } else if (step.type === "DEDUPLICATE") {
          await this.store.emitRunEvent?.(runId, ActivityActions.DEDUPLICATION_COMPLETED, {
            stepId: step.id,
            ...(typeof output === "object" && output !== null ? output as Record<string, unknown> : {}),
          });
        } else if (step.type === "SAVE") {
          await this.store.emitRunEvent?.(runId, ActivityActions.DATASET_CREATED, {
            stepId: step.id,
            ...(typeof output === "object" && output !== null ? output as Record<string, unknown> : {}),
          });
        }
        const sourceIds = agentResult ? await this.store.resolveSourceIds(runId, agentResult.sources.map((source) => source.canonicalUrl)) : [];
        await this.store.finishStep(runId, stepRowId, { status: "COMPLETED", startedAt, output, retryCount, ...(agentResult ? { sourceIds } : {}) });
        return { status: "COMPLETED", ...(agentResult ? { agentResult } : {}), output };
      } catch (error) {
        lastError = error;
        if (await this.store.isCancellationRequested(runId)) {
          await this.store.finishStep(runId, stepRowId, { status: "CANCELLED", startedAt, retryCount, errorCode: "RUN_CANCELLED", errorMessage: "Run cancellation was requested." });
          return { status: "CANCELLED" };
        }
        const code = errorCode(error);
        const retryable = isRetryable(error, step);
        if (!retryable || retryCount >= maxRetries) {
          const status: StepStatus = code === "SOURCE_BLOCKED_BY_POLICY" ? "BLOCKED" : "FAILED";
          await this.store.finishStep(runId, stepRowId, { status, startedAt, retryCount, errorCode: code, errorMessage: safeError(error) });
          this.logger.warn({ runId, stepId: step.id, stepType: step.type, errorCode: code, retryCount }, "Workflow step failed");
          return { status };
        }
        await this.store.finishStep(runId, stepRowId, { status: "FAILED", startedAt, retryCount, errorCode: code, errorMessage: safeError(error) });
        const delay = step.retryPolicy.backoff === "exponential" ? Math.min(step.retryPolicy.maxDelayMs, step.retryPolicy.initialDelayMs * step.retryPolicy.multiplier ** retryCount) : 0;
        retryCount += 1;
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    this.logger.error({ runId, stepId: step.id, errorMessage: safeError(lastError) }, "Workflow step exhausted retries");
    return { status: "FAILED" };
  }

  private async cancelRemaining(context: ExecutionRunContext, completed: Map<string, StepStatus>): Promise<void> {
    for (const [index, step] of context.plan.steps.entries()) {
      if (completed.has(step.id)) continue;
      await this.store.finishStep(context.id, await this.stepDatabaseId(context.id, index), { status: "CANCELLED", startedAt: new Date(), retryCount: 0, errorCode: "RUN_CANCELLED", errorMessage: "Run cancellation was requested." });
    }
  }

  private async stepDatabaseId(runId: string, sequence: number): Promise<string> {
    return this.store.getStepsBySequence(runId, sequence);
  }
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code.slice(0, 100);
  return "STEP_EXECUTION_FAILED";
}
function isAgentStep(type: WorkflowStep["type"]): type is "SEARCH" | "SCRAPE" | "INTERACT" | "EXTRACT" { return type === "SEARCH" || type === "SCRAPE" || type === "INTERACT" || type === "EXTRACT"; }
function safeError(error: unknown): string { return (error instanceof Error ? error.message : "Step execution failed.").replace(/(?:fc-[\w-]{12,}|AIza[\w-]{20,}|AQ\.[\w-]{10,})/g, "[REDACTED]").slice(0, 1000); }
function isRetryable(error: unknown, step: WorkflowStep): boolean {
  const code = errorCode(error);
  if (error && typeof error === "object" && "retryable" in error) return error.retryable === true;
  return ["TIMEOUT", "RATE_LIMIT", "TRANSIENT_NETWORK", "SERVER_ERROR"].some((entry) => step.retryPolicy.retryableErrors.includes(entry as never) && code.includes(entry));
}

function mergeResults(previous: AgentResult | undefined, next: AgentResult): AgentResult {
  if (!previous) return next;
  const sources = new Map(previous.sources.map((source) => [source.canonicalUrl, source]));
  for (const source of next.sources) sources.set(source.canonicalUrl, source);
  const records = [...previous.records, ...next.records];
  return { ...next, records, sources: [...sources.values()], errors: [...previous.errors, ...next.errors], events: [...previous.events, ...next.events] };
}

function runCounts(result: AgentResult | undefined): { records: number; validRecords: number; sources: number; duplicates: number } {
  return {
    records: result?.dataQuality?.metrics.rawRecordCount ?? result?.records.length ?? 0,
    validRecords: result?.dataQuality?.metrics.validRecordCount ?? result?.records.filter((record) => record.isValid !== false).length ?? 0,
    sources: result?.sources.filter((source) => source.verifiedByTool).length ?? 0,
    duplicates: result?.dataQuality?.metrics.duplicateCount ?? 0,
  };
}
