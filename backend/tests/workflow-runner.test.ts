import pino from "pino";
import { describe, expect, it } from "vitest";
import { MockAgentAdapter } from "../src/agent/MockAgentAdapter.js";
import type { AgentResult } from "../src/agent/types.js";
import type { ExecutionRunContext } from "../src/db/repositories/workflow-execution.repository.js";
import { WorkflowRunner } from "../src/modules/workflows/workflow-runner.js";
import type { WorkflowPlan } from "../src/modules/planner/workflow-plan.schema.js";

const retryPolicy = { maxAttempts: 2, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: ["TRANSIENT_NETWORK"] } as const;
const rawSteps = [
  { id: "search", type: "SEARCH", description: "Find sources", input: {}, configuration: {}, dependencies: [], retryPolicy, timeoutMs: 10_000, expectedOutput: "Sources", status: "PENDING" },
  { id: "scrape", type: "SCRAPE", description: "Read sources", input: {}, configuration: {}, dependencies: ["search"], retryPolicy, timeoutMs: 10_000, expectedOutput: "Pages", status: "PENDING" },
  { id: "extract", type: "EXTRACT", description: "Extract rows", input: {}, configuration: {}, dependencies: ["scrape"], retryPolicy, timeoutMs: 10_000, expectedOutput: "Rows", status: "PENDING" },
  { id: "validate", type: "VALIDATE", description: "Validate rows", input: {}, configuration: {}, dependencies: ["extract"], retryPolicy, timeoutMs: 10_000, expectedOutput: "Valid rows", status: "PENDING" },
  { id: "dedupe", type: "DEDUPLICATE", description: "Remove exact duplicates", input: {}, configuration: {}, dependencies: ["validate"], retryPolicy, timeoutMs: 10_000, expectedOutput: "Unique rows", status: "PENDING" },
  { id: "save", type: "SAVE", description: "Persist dataset", input: {}, configuration: {}, dependencies: ["dedupe"], retryPolicy, timeoutMs: 10_000, expectedOutput: "Dataset", status: "PENDING" },
];
const plan = { version: 1, objective: "Collect entities", requirement: { requiredFields: ["name"] }, constraints: [], sourcePolicy: {}, searchStrategy: {}, steps: rawSteps,
  extractionSchema: { properties: { name: { type: "string", description: "Name" } }, required: ["name"] }, transformations: [], validationRules: [],
  deduplicationRules: [{ keys: ["name"], strategy: "NORMALIZED", confidenceThreshold: 1, ambiguousMatchAction: "KEEP_SEPARATE", rationale: "normalized key" }],
  completionCriteria: {}, outputConfiguration: {} } as unknown as WorkflowPlan;

function createContext(cancelRequestedAt: Date | null = null): ExecutionRunContext {
  return { id: "run-1", workspaceId: "workspace-1", workflowId: "workflow-1", createdById: "user-1", requirement: "Collect entities", plan, cancelRequestedAt };
}

function result(status: AgentResult["status"] = "COMPLETED"): AgentResult {
  const now = new Date().toISOString();
  return { status, data: null, records: [{ values: { name: "Acme" }, sourceUrls: ["https://example.com/"] }],
    sources: [{ url: "https://example.com/", canonicalUrl: "https://example.com/", domain: "example.com", sourceType: "search", retrievedAt: now, verifiedByTool: true }],
    execution: { provider: "mock", model: "mock", startedAt: now, finishedAt: now, durationMs: 1, inputTokens: 0, outputTokens: 0, totalTokens: 0, toolCallCount: 1, toolsUsed: ["search"] },
    events: [], errors: status === "FAILED" ? [{ code: "TRANSIENT_NETWORK", message: "temporary failure", retryable: true }] : [] };
}

function fakeStore(cancel = false) {
  const statuses = new Map<string, string>();
  const calls: string[] = [];
  let requested = cancel;
  let savedResult: AgentResult | undefined;
  const store = {
    getExecutionContext: async () => createContext(), markRunStarted: async () => { calls.push("run-started"); return true; },
    startStep: async (_run: string, id: string, retry: number) => { calls.push(`start:${id}:${retry}`); },
    finishStep: async (_run: string, id: string, value: { status: string }) => { statuses.set(id, value.status); calls.push(`finish:${id}:${value.status}`); },
    setRunProgress: async () => undefined, isCancellationRequested: async () => requested,
    finishRun: async (_run: string, status: string) => { calls.push(`run:${status}`); },
    getStepsBySequence: async (_run: string, sequence: number) => `step-${sequence}`,
    resolveSourceIds: async () => ["source-1"],
    persistDataset: async (_context: ExecutionRunContext, result: AgentResult) => {
      savedResult = result;
      return { datasetId: "dataset-1", recordCount: 1, sourceCount: 1 };
    },
    statuses, calls, cancel: () => { requested = true; }, saved: () => savedResult,
  };
  return store;
}

describe("WorkflowRunner", () => {
  it("runs the saved step sequence in dependency order and persists through SAVE", async () => {
    const store = fakeStore();
    const adapter = new MockAgentAdapter(() => result());
    await new WorkflowRunner(store, adapter, pino({ enabled: false })).run("run-1");
    expect(adapter.inputs.map((input) => input.stepType)).toEqual(["SEARCH", "SCRAPE", "EXTRACT"]);
    expect(store.calls.filter((call) => call.startsWith("finish:")).map((call) => call.split(":")[2])).toEqual(Array(6).fill("COMPLETED"));
    expect(store.calls.at(-1)).toBe("run:COMPLETED");
    expect(store.saved()?.dataQuality?.metrics).toMatchObject({ rawRecordCount: 3, validRecordCount: 1, duplicateCount: 2, sourceBackedRecordCount: 3 });
    expect(store.saved()?.records[0]?.rawValues).toEqual({ name: "Acme" });
  });

  it("retries a transient failure and skips all dependent steps after permanent failure", async () => {
    const store = fakeStore();
    let calls = 0;
    const adapter = new MockAgentAdapter(() => ++calls === 1 ? result("FAILED") : result());
    await new WorkflowRunner(store, adapter, pino({ enabled: false })).run("run-1");
    expect(calls).toBe(4);
    expect(store.calls).toContain("start:step-0:1");
    expect(store.calls.at(-1)).toBe("run:COMPLETED");
  });

  it("marks pending steps cancelled before starting when cancellation was requested", async () => {
    const store = fakeStore(true);
    const adapter = new MockAgentAdapter();
    await new WorkflowRunner(store, adapter, pino({ enabled: false })).run("run-1");
    expect(adapter.inputs).toHaveLength(0);
    expect(store.calls.filter((call) => call.startsWith("finish:") && call.endsWith(":CANCELLED"))).toHaveLength(rawSteps.length);
    expect(store.calls.at(-1)).toBe("run:CANCELLED");
  });
});
