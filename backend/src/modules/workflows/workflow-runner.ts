import type { Logger } from "pino";
import type { AgentAdapter, AgentResult } from "../../agent/types.js";
import type { ExecutionRunContext } from "../../db/repositories/workflow-execution.repository.js";
import type { WorkflowStep } from "../planner/workflow-plan.schema.js";

export interface WorkflowRunnerStore {
  getExecutionContext(runId: string): Promise<ExecutionRunContext>;
  markRunStarted(runId: string): Promise<boolean>;
  startStep(runId: string, stepId: string, retryCount: number): Promise<void>;
  finishStep(runId: string, stepId: string, input: { status: "COMPLETED" | "FAILED" | "SKIPPED" | "BLOCKED" | "CANCELLED"; startedAt: Date; output?: unknown; errorCode?: string; errorMessage?: string; sourceIds?: string[]; retryCount: number }): Promise<void>;
  setRunProgress(runId: string, progress: number): Promise<void>;
  isCancellationRequested(runId: string): Promise<boolean>;
  finishRun(runId: string, status: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED", error?: { code: string; message: string }, counts?: { records: number; sources: number }): Promise<void>;
  getStepsBySequence(runId: string, sequence: number): Promise<string>;
  resolveSourceIds(runId: string, sourceUrls: string[]): Promise<string[]>;
  persistDataset(context: ExecutionRunContext, result: AgentResult): Promise<{ datasetId: string; recordCount: number; sourceCount: number }>;
}

type StepStatus = "COMPLETED" | "FAILED" | "SKIPPED" | "BLOCKED" | "CANCELLED";

/** Executes a persisted, schema-validated plan in dependency order; parallel execution is intentionally disabled. */
export class WorkflowRunner {
  constructor(private readonly store: WorkflowRunnerStore, private readonly agent: AgentAdapter, private readonly logger: Logger) {}

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
      if (result.agentResult) finalResult = mergeResults(finalResult, result.agentResult);
      if (result.agentResult?.status === "PARTIAL") partialResult = true;
      if (result.status === "FAILED" || result.status === "BLOCKED") failed = true;
      if (result.status === "SKIPPED") skipped = true;
      if (result.status === "CANCELLED") { cancelled = true; break; }
      await this.store.setRunProgress(runId, ((index + 1) / context.plan.steps.length) * 100);
    }

    if (cancelled || await this.store.isCancellationRequested(runId)) {
      await this.cancelRemaining(context, completed);
      await this.store.finishRun(runId, "CANCELLED", undefined, { records: finalResult?.records.length ?? 0, sources: finalResult?.sources.length ?? 0 });
    } else if (failed) {
      const partial = (finalResult?.records.length ?? 0) > 0;
      await this.store.finishRun(runId, partial ? "PARTIAL" : "FAILED", { code: "WORKFLOW_STEP_FAILED", message: "One or more workflow steps failed; inspect step errors for details." }, { records: finalResult?.records.length ?? 0, sources: finalResult?.sources.length ?? 0 });
    } else if (skipped) {
      await this.store.finishRun(runId, "PARTIAL", { code: "WORKFLOW_STEPS_SKIPPED", message: "One or more planned steps were skipped; inspect step details for reasons." }, { records: finalResult?.records.length ?? 0, sources: finalResult?.sources.length ?? 0 });
    } else if (partialResult) {
      const firstError = finalResult?.errors[0];
      await this.store.finishRun(runId, "PARTIAL", firstError ? { code: firstError.code, message: firstError.message } : { code: "AGENT_PARTIAL_RESULT", message: "The agent returned incomplete results; inspect source and step details." }, { records: finalResult?.records.length ?? 0, sources: finalResult?.sources.length ?? 0 });
    } else {
      await this.store.finishRun(runId, "COMPLETED", undefined, { records: finalResult?.records.length ?? 0, sources: finalResult?.sources.length ?? 0 });
    }
  }

  private async executeStep(context: ExecutionRunContext, step: WorkflowStep, index: number, runId: string, priorResult?: AgentResult): Promise<{ status: StepStatus; agentResult?: AgentResult }> {
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
          applyTransformations(priorResult.records, context.plan.transformations);
          output = { recordCount: priorResult.records.length, transformationCount: context.plan.transformations.length };
        } else if (step.type === "VALIDATE" && priorResult) {
          const issues = validateRecords(priorResult.records, context.plan.validationRules, context.plan.extractionSchema.properties, context.plan.requirement.requiredFields);
          output = { recordCount: priorResult.records.length, validationRules: context.plan.validationRules.length, issueCount: issues, invalidRecordCount: priorResult.records.filter((record) => record.isValid === false).length };
        } else if (step.type === "DEDUPLICATE" && priorResult) {
          const before = priorResult.records.length;
          deduplicateRecords(priorResult.records, context.plan.deduplicationRules);
          output = { recordCount: priorResult.records.length, duplicateCount: before - priorResult.records.length };
        } else if (step.type === "MERGE" && priorResult) {
          output = { recordCount: priorResult.records.length, provenanceSources: priorResult.sources.length };
        } else if (step.type === "SAVE") {
          if (!priorResult?.records.length) throw Object.assign(new Error("No extracted records are available to save."), { code: "NO_RECORDS_TO_SAVE", retryable: false });
          output = await this.store.persistDataset(context, priorResult);
        } else if (step.type === "EXPORT") {
          await this.store.finishStep(runId, stepRowId, { status: "SKIPPED", startedAt, retryCount, errorCode: "EXPORT_NOT_IN_PHASE", errorMessage: "Export execution is provided by the exports phase." });
          return { status: "SKIPPED" };
        }
        const sourceIds = agentResult ? await this.store.resolveSourceIds(runId, agentResult.sources.map((source) => source.canonicalUrl)) : [];
        await this.store.finishStep(runId, stepRowId, { status: "COMPLETED", startedAt, output, retryCount, ...(agentResult ? { sourceIds } : {}) });
        return { status: "COMPLETED", ...(agentResult ? { agentResult } : {}) };
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
  const records = [...previous.records];
  for (const record of next.records) {
    const signature = JSON.stringify(Object.fromEntries(Object.entries(record.values).sort(([left], [right]) => left.localeCompare(right))));
    const existing = records.find((candidate) => JSON.stringify(Object.fromEntries(Object.entries(candidate.values).sort(([left], [right]) => left.localeCompare(right)))) === signature);
    if (existing) existing.sourceUrls = [...new Set([...existing.sourceUrls, ...record.sourceUrls])];
    else records.push(record);
  }
  return { ...next, records, sources: [...sources.values()], errors: [...previous.errors, ...next.errors], events: [...previous.events, ...next.events] };
}

function applyTransformations(records: AgentResult["records"], transformations: ExecutionRunContext["plan"]["transformations"]): void {
  for (const record of records) for (const transform of transformations) {
    if (!transform.fieldKey) continue;
    const value = record.values[transform.fieldKey];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    switch (transform.operation) {
      case "TRIM_WHITESPACE": record.values[transform.fieldKey] = trimmed; break;
      case "NORMALIZE_TEXT": record.values[transform.fieldKey] = trimmed.replace(/\s+/g, " "); break;
      case "NORMALIZE_URL": try { const url = new URL(trimmed); url.hash = ""; record.values[transform.fieldKey] = url.toString(); } catch { record.values[transform.fieldKey] = trimmed; } break;
      case "NORMALIZE_DATE": { const date = new Date(trimmed); if (!Number.isNaN(date.getTime())) record.values[transform.fieldKey] = date.toISOString(); break; }
      case "PARSE_NUMBER": { const number = Number(trimmed.replace(/[^\d.+-]/g, "")); if (Number.isFinite(number)) record.values[transform.fieldKey] = number; break; }
      case "NORMALIZE_CURRENCY": { const number = Number(trimmed.replace(/[^\d.+-]/g, "")); if (Number.isFinite(number)) record.values[transform.fieldKey] = number; break; }
      case "NORMALIZE_PHONE": record.values[transform.fieldKey] = trimmed.replace(/[^\d+]/g, ""); break;
    }
  }
}

function deduplicateRecords(records: AgentResult["records"], rules: ExecutionRunContext["plan"]["deduplicationRules"]): void {
  const canonical = new Map<string, AgentResult["records"][number]>();
  const retained: AgentResult["records"] = [];
  for (const record of records) {
    const deterministicRules = rules.filter((rule) => rule.strategy !== "FUZZY_REVIEW");
    if (deterministicRules.length === 0) { retained.push(record); continue; }
    const key = deterministicRules.map((rule) => `${rule.strategy}:${rule.keys.map((field) => rule.strategy === "NORMALIZED" ? normalizeDuplicateValue(record.values[field]) : exactDuplicateValue(record.values[field])).join("|")}`).join(";#");
    if (!key || key.includes("undefined")) { retained.push(record); continue; }
    const existing = canonical.get(key);
    if (!existing) { canonical.set(key, record); retained.push(record); continue; }
    existing.sourceUrls = [...new Set([...existing.sourceUrls, ...record.sourceUrls])];
    for (const [field, value] of Object.entries(record.values)) if (existing.values[field] == null && value != null) existing.values[field] = value;
  }
  records.splice(0, records.length, ...retained);
}

function normalizeDuplicateValue(value: unknown): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase().replace(/\s+/g, " ") : value == null ? "undefined" : JSON.stringify(value);
}
function exactDuplicateValue(value: unknown): string { return value == null ? "undefined" : JSON.stringify(value); }

function validateRecords(records: AgentResult["records"], rules: ExecutionRunContext["plan"]["validationRules"], properties: ExecutionRunContext["plan"]["extractionSchema"]["properties"], requiredFields: string[]): number {
  let count = 0;
  for (const record of records) {
    const issues: NonNullable<AgentResult["records"][number]["validationIssues"]> = [];
    for (const rule of rules) {
      const field = rule.fieldKey ?? undefined;
      const value = field ? record.values[field] : undefined;
      let message: string | undefined;
      switch (rule.rule) {
        case "REQUIRED": if (value === undefined || value === null || value === "") message = rule.description; break;
        case "TYPE": {
          if (field && value != null) {
            const expected = properties[field]?.type;
            const valid = expected === "string" ? typeof value === "string" : expected === "number" ? typeof value === "number" && Number.isFinite(value) : expected === "integer" ? typeof value === "number" && Number.isInteger(value) : expected === "boolean" ? typeof value === "boolean" : expected === "array" ? Array.isArray(value) : expected === "object" ? Boolean(value && typeof value === "object" && !Array.isArray(value)) : true;
            if (!valid) message = rule.description;
          }
          break;
        }
        case "URL": if (field && value != null && !isHttpUrl(value)) message = rule.description; break;
        case "EMAIL": if (field && value != null && (typeof value !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) message = rule.description; break;
        case "DATE": if (field && value != null && (typeof value !== "string" || Number.isNaN(Date.parse(value)))) message = rule.description; break;
        case "SOURCE_EVIDENCE": if (record.sourceUrls.length === 0) message = rule.description; break;
        case "RANGE": case "CUSTOM": message = `Rule was not executed because this plan rule has no safe machine-readable parameters: ${rule.description}`; break;
      }
      if (message) issues.push({ ...(field ? { fieldKey: field } : {}), ruleCode: rule.rule, severity: rule.rule === "CUSTOM" || rule.rule === "RANGE" ? "WARNING" : rule.severity, message: message.slice(0, 1000) });
    }
    for (const fieldKey of requiredFields) {
      if (record.values[fieldKey] === undefined || record.values[fieldKey] === null || record.values[fieldKey] === "") {
        if (!issues.some((issue) => issue.fieldKey === fieldKey && issue.ruleCode === "REQUIRED")) issues.push({ fieldKey, ruleCode: "REQUIRED", severity: "ERROR", message: "Required field is missing." });
      }
    }
    if (record.sourceUrls.length === 0 && !issues.some((issue) => issue.ruleCode === "SOURCE_EVIDENCE")) {
      issues.push({ ruleCode: "SOURCE_EVIDENCE", severity: "ERROR", message: "Record has no source URL observed from an enabled collection tool." });
    }
    record.validationIssues = issues;
    record.isValid = issues.every((issue) => issue.severity !== "ERROR");
    count += issues.length;
  }
  return count;
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; }
}
