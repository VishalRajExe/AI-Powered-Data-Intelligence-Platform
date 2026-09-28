import { EventEmitter } from "node:events";
import type { PrismaClient } from "@prisma/client";
import pino from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnvConfig } from "../src/config/env.js";
import { MockAgentAdapter } from "../src/agent/MockAgentAdapter.js";
import { WorkflowHistoryRepository } from "../src/db/repositories/workflow-history.repository.js";
import { WorkflowExecutionRepository } from "../src/db/repositories/workflow-execution.repository.js";
import { WorkflowEventBroadcaster } from "../src/modules/monitoring/event-broadcaster.js";
import { ActivityActions, type RunActivityEvent } from "../src/modules/monitoring/monitoring.types.js";
import { WorkflowRunner } from "../src/modules/workflows/workflow-runner.js";
import type { AgentResult } from "../src/agent/types.js";
import type { WorkflowPlan } from "../src/modules/planner/workflow-plan.schema.js";

const WS = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const USER = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const WF_ID = "c3d4e5f6-a7b8-9012-cdef-123456789012";
const RUN_ID = "d4e5f6a7-b8c9-0123-def1-234567890123";

const sampleDate1 = new Date("2026-09-28T10:00:00.000Z");
const sampleDate2 = new Date("2026-09-28T10:05:00.000Z");

function mockPrisma() {
  const activityEventsStore: Array<{
    id: string;
    workspaceId: string;
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    details: unknown;
    createdAt: Date;
  }> = [];

  const prisma = {
    workspaceMember: {
      findUnique: async () => ({ status: "ACTIVE" }),
    },
    workflow: {
      count: async () => 1,
      findMany: async () => [
        {
          id: WF_ID,
          workspaceId: WS,
          name: "Extract Tech Companies",
          requirement: "Find tech companies with founders and revenue",
          status: "ACTIVE",
          planningStatus: "PLANNED",
          createdAt: sampleDate1,
          updatedAt: sampleDate2,
          _count: { runs: 2 },
          runs: [
            {
              id: RUN_ID,
              status: "COMPLETED",
              startedAt: sampleDate1,
              finishedAt: sampleDate2,
              recordsFound: 50,
              recordsValid: 48,
              duplicateCount: 2,
              sourcesProcessed: 5,
              sourcesFailed: 0,
              dataset: {
                id: "e5f6a7b8-c9d0-1234-ef12-345678901234",
                name: "Extract Tech Companies",
                recordCount: 48,
                validCount: 48,
                duplicateCount: 2,
                sourceCount: 5,
                status: "READY",
                createdAt: sampleDate2,
              },
            },
          ],
        },
      ],
      findFirst: async () => ({
        id: WF_ID,
        workspaceId: WS,
        createdById: USER,
        name: "Extract Tech Companies",
        requirement: "Find tech companies with founders and revenue",
        status: "ACTIVE",
        planningStatus: "PLANNED",
        planningErrorCode: null,
        planningErrorMessage: null,
        createdAt: sampleDate1,
        updatedAt: sampleDate2,
        plans: [
          {
            id: "plan-1",
            version: 1,
            objective: "Extract Tech Companies",
            steps: [{ id: "step-1" }, { id: "step-2" }],
            planHash: "abc123hash",
            createdAt: sampleDate1,
          },
        ],
        runs: [
          {
            id: RUN_ID,
            workspaceId: WS,
            workflowId: WF_ID,
            workflowPlanId: "plan-1",
            status: "COMPLETED",
            progress: 100,
            startedAt: sampleDate1,
            finishedAt: sampleDate2,
            recordsFound: 50,
            recordsValid: 48,
            duplicateCount: 2,
            sourcesProcessed: 5,
            sourcesFailed: 0,
            errorCode: null,
            errorMessage: null,
            cancelRequestedAt: null,
            createdAt: sampleDate1,
            updatedAt: sampleDate2,
            dataset: {
              id: "dataset-1",
              name: "Extract Tech Companies",
              recordCount: 48,
              validCount: 48,
              duplicateCount: 2,
              sourceCount: 5,
              status: "READY",
              createdAt: sampleDate2,
            },
            steps: [
              {
                id: "step-1",
                sequence: 0,
                type: "SEARCH",
                status: "COMPLETED",
                attempt: 1,
                retryCount: 0,
                durationMs: 1200,
                startedAt: sampleDate1,
                finishedAt: new Date(sampleDate1.getTime() + 1200),
                outputSummary: { sourceCount: 5 },
                errorCode: null,
                errorMessage: null,
              },
            ],
          },
        ],
        _count: { runs: 2 },
      }),
    },
    workflowRun: {
      count: async () => 1,
      findMany: async () => [
        {
          id: RUN_ID,
          workspaceId: WS,
          workflowId: WF_ID,
          workflowPlanId: "plan-1",
          status: "COMPLETED",
          progress: 100,
          startedAt: sampleDate1,
          finishedAt: sampleDate2,
          recordsFound: 50,
          recordsValid: 48,
          duplicateCount: 2,
          sourcesProcessed: 5,
          sourcesFailed: 0,
          errorCode: null,
          errorMessage: null,
          cancelRequestedAt: null,
          createdAt: sampleDate1,
          updatedAt: sampleDate2,
          dataset: {
            id: "dataset-1",
            name: "Extract Tech Companies",
            recordCount: 48,
            validCount: 48,
            duplicateCount: 2,
            sourceCount: 5,
            status: "READY",
            createdAt: sampleDate2,
          },
        },
      ],
      findFirst: async () => ({
        id: RUN_ID,
        workspaceId: WS,
        workflowId: WF_ID,
        workflowPlanId: "plan-1",
        status: "COMPLETED",
        progress: 100,
        startedAt: sampleDate1,
        finishedAt: sampleDate2,
        recordsFound: 50,
        recordsValid: 48,
        duplicateCount: 2,
        sourcesProcessed: 5,
        sourcesFailed: 0,
        errorCode: null,
        errorMessage: null,
        cancelRequestedAt: null,
        createdAt: sampleDate1,
        updatedAt: sampleDate2,
        workflow: { name: "Extract Tech Companies" },
        dataset: {
          id: "dataset-1",
          name: "Extract Tech Companies",
          recordCount: 48,
          validCount: 48,
          duplicateCount: 2,
          sourceCount: 5,
          status: "READY",
          createdAt: sampleDate2,
        },
        steps: [
          {
            id: "step-1",
            sequence: 0,
            type: "SEARCH",
            status: "COMPLETED",
            attempt: 1,
            retryCount: 0,
            durationMs: 1200,
            startedAt: sampleDate1,
            finishedAt: new Date(sampleDate1.getTime() + 1200),
            outputSummary: { sourceCount: 5 },
            errorCode: null,
            errorMessage: null,
          },
        ],
      }),
      findUnique: async () => ({
        id: RUN_ID,
        workspaceId: WS,
        status: "COMPLETED",
      }),
    },
    activityEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const ev = {
          id: `ev-${activityEventsStore.length + 1}`,
          workspaceId: String(data.workspaceId),
          actorId: (data.actorId as string | null) ?? null,
          action: String(data.action),
          entityType: String(data.entityType),
          entityId: String(data.entityId),
          details: data.details ?? null,
          createdAt: new Date(),
        };
        activityEventsStore.push(ev);
        return ev;
      },
      findMany: async () => activityEventsStore,
    },
    activityEventsStore,
  } as unknown as PrismaClient & { activityEventsStore: unknown[] };

  return prisma;
}

describe("Phase 11 — Workflow History & Monitoring", () => {
  it("lists workflows with original prompt, created time, status, last run summary, dataset, and number of runs", async () => {
    const prisma = mockPrisma();
    const repo = new WorkflowHistoryRepository(prisma);

    const result = await repo.listWorkflows(WS, USER);
    expect(result.items).toHaveLength(1);
    const wf = result.items[0]!;
    expect(wf.name).toBe("Extract Tech Companies");
    expect(wf.originalPrompt).toBe("Find tech companies with founders and revenue");
    expect(wf.createdTime).toBe(sampleDate1.toISOString());
    expect(wf.status).toBe("ACTIVE");
    expect(wf.numberOfRuns).toBe(2);
    expect(wf.runsCount).toBe(2);

    // Verify last run summary
    expect(wf.lastRun).not.toBeNull();
    expect(wf.lastRun?.status).toBe("COMPLETED");
    expect(wf.lastRun?.recordsFound).toBe(50);
    expect(wf.lastRun?.recordsAccepted).toBe(48);
    expect(wf.lastRun?.duplicates).toBe(2);
    expect(wf.lastRun?.failures).toBe(0);
    expect(wf.lastRun?.sourceCount).toBe(5);
    expect(wf.lastRun?.duration).toBe(300000); // 5 minutes in ms

    // Verify dataset summary
    expect(wf.dataset).not.toBeNull();
    expect(wf.dataset?.recordCount).toBe(48);
    expect(wf.dataset?.status).toBe("READY");
  });

  it("retrieves workflow detail with history and recent runs", async () => {
    const prisma = mockPrisma();
    const repo = new WorkflowHistoryRepository(prisma);

    const wf = await repo.getWorkflow(WS, WF_ID, USER);
    expect(wf.id).toBe(WF_ID);
    expect(wf.name).toBe("Extract Tech Companies");
    expect(wf.latestPlan?.version).toBe(1);
    expect(wf.recentRuns).toHaveLength(1);
    expect(wf.recentRuns[0]?.status).toBe("COMPLETED");
    expect(wf.recentRuns[0]?.recordsAccepted).toBe(48);
  });

  it("retrieves workflow runs with duration, records found, records accepted, duplicates, failures, and source count", async () => {
    const prisma = mockPrisma();
    const repo = new WorkflowHistoryRepository(prisma);

    const runs = await repo.getWorkflowRuns(WS, WF_ID, USER);
    expect(runs.items).toHaveLength(1);
    const run = runs.items[0]!;
    expect(run.started).toBe(sampleDate1.toISOString());
    expect(run.completed).toBe(sampleDate2.toISOString());
    expect(run.duration).toBe(300000);
    expect(run.recordsFound).toBe(50);
    expect(run.recordsAccepted).toBe(48);
    expect(run.duplicates).toBe(2);
    expect(run.failures).toBe(0);
    expect(run.sourceCount).toBe(5);
  });

  it("retrieves single run view with step history and dataset", async () => {
    const prisma = mockPrisma();
    const repo = new WorkflowHistoryRepository(prisma);

    const run = await repo.getRun(WS, RUN_ID, USER);
    expect(run.id).toBe(RUN_ID);
    expect(run.workflowName).toBe("Extract Tech Companies");
    expect(run.steps).toHaveLength(1);
    expect(run.steps?.[0]?.type).toBe("SEARCH");
    expect(run.steps?.[0]?.durationMs).toBe(1200);
    expect(run.dataset?.recordCount).toBe(48);
  });

  it("records durable activity events in MySQL and does not keep them only in memory", async () => {
    const prisma = mockPrisma();
    const broadcaster = new WorkflowEventBroadcaster(prisma);

    const event = await broadcaster.recordAndBroadcast({
      workspaceId: WS,
      action: ActivityActions.SOURCE_DISCOVERY_STARTED,
      entityType: "workflow_run",
      entityId: RUN_ID,
      details: { query: "tech companies" },
    });

    expect(event.action).toBe("SOURCE_DISCOVERY_STARTED");
    expect(event.entityId).toBe(RUN_ID);

    // Verify it is durable in MySQL
    const history = await broadcaster.getHistory(WS, RUN_ID);
    expect(history.some((e) => e.action === ActivityActions.SOURCE_DISCOVERY_STARTED)).toBe(true);
  });

  it("propagates canonical activity events through WorkflowRunner", async () => {
    const emittedEvents: Array<{ action: string; details?: unknown }> = [];

    const store = {
      getExecutionContext: async () => ({
        id: RUN_ID,
        workspaceId: WS,
        workflowId: WF_ID,
        createdById: USER,
        requirement: "Collect entities",
        plan: {
          version: 1,
          objective: "Collect entities",
          steps: [
            {
              id: "search",
              type: "SEARCH",
              description: "Search",
              input: {},
              configuration: {},
              dependencies: [],
              retryPolicy: { maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [] },
              timeoutMs: 5000,
              expectedOutput: "Sources",
              status: "PENDING",
            },
            {
              id: "scrape",
              type: "SCRAPE",
              description: "Scrape",
              input: {},
              configuration: {},
              dependencies: ["search"],
              retryPolicy: { maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [] },
              timeoutMs: 5000,
              expectedOutput: "Pages",
              status: "PENDING",
            },
            {
              id: "extract",
              type: "EXTRACT",
              description: "Extract",
              input: {},
              configuration: {},
              dependencies: ["scrape"],
              retryPolicy: { maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [] },
              timeoutMs: 5000,
              expectedOutput: "Records",
              status: "PENDING",
            },
            {
              id: "validate",
              type: "VALIDATE",
              description: "Validate",
              input: {},
              configuration: {},
              dependencies: ["extract"],
              retryPolicy: { maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [] },
              timeoutMs: 5000,
              expectedOutput: "Valid records",
              status: "PENDING",
            },
            {
              id: "dedupe",
              type: "DEDUPLICATE",
              description: "Dedupe",
              input: {},
              configuration: {},
              dependencies: ["validate"],
              retryPolicy: { maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [] },
              timeoutMs: 5000,
              expectedOutput: "Unique records",
              status: "PENDING",
            },
            {
              id: "save",
              type: "SAVE",
              description: "Save",
              input: {},
              configuration: {},
              dependencies: ["dedupe"],
              retryPolicy: { maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [] },
              timeoutMs: 5000,
              expectedOutput: "Dataset",
              status: "PENDING",
            },
          ],
          requirement: { requiredFields: ["name"] },
          constraints: [],
          extractionSchema: { properties: { name: { type: "string", description: "Name" } }, required: ["name"] },
          transformations: [],
          validationRules: [],
          deduplicationRules: [{ keys: ["name"], strategy: "NORMALIZED", confidenceThreshold: 1, ambiguousMatchAction: "KEEP_SEPARATE", rationale: "key" }],
          completionCriteria: {},
          sourcePolicy: {},
          searchStrategy: {},
          outputConfiguration: {},
        } as unknown as WorkflowPlan,
        cancelRequestedAt: null,
      }),
      markRunStarted: async () => true,
      startStep: async () => undefined,
      finishStep: async () => undefined,
      setRunProgress: async () => undefined,
      isCancellationRequested: async () => false,
      finishRun: async (_runId: string, status: string) => {
        emittedEvents.push({ action: status === "COMPLETED" ? ActivityActions.RUN_COMPLETED : ActivityActions.RUN_FAILED });
      },
      getStepsBySequence: async (_runId: string, seq: number) => `step-${seq}`,
      resolveSourceIds: async () => ["src-1"],
      persistDataset: async () => ({ datasetId: "ds-1", recordCount: 1, sourceCount: 1 }),
      emitRunEvent: async (_runId: string, action: string, details?: Record<string, unknown>) => {
        emittedEvents.push({ action, details });
      },
    };

    const agentResult: AgentResult = {
      status: "COMPLETED",
      data: null,
      records: [{ values: { name: "Acme Corp" }, sourceUrls: ["https://example.com/acme"] }],
      sources: [{ url: "https://example.com/acme", canonicalUrl: "https://example.com/acme", domain: "example.com", sourceType: "search", retrievedAt: new Date().toISOString(), verifiedByTool: true }],
      execution: { provider: "mock", model: "mock", startedAt: "", finishedAt: "", durationMs: 10, inputTokens: 0, outputTokens: 0, totalTokens: 0, toolCallCount: 1, toolsUsed: ["search"] },
      events: [],
      errors: [],
    };

    const adapter = new MockAgentAdapter(() => agentResult);
    const runner = new WorkflowRunner(store, adapter, pino({ enabled: false }));
    await runner.run(RUN_ID);

    const actions = emittedEvents.map((e) => e.action);
    expect(actions).toContain(ActivityActions.SOURCE_DISCOVERY_STARTED);
    expect(actions).toContain(ActivityActions.SOURCE_DISCOVERED);
    expect(actions).toContain(ActivityActions.SCRAPE_STARTED);
    expect(actions).toContain(ActivityActions.SCRAPE_COMPLETED);
    expect(actions).toContain(ActivityActions.EXTRACTION_STARTED);
    expect(actions).toContain(ActivityActions.RECORDS_EXTRACTED);
    expect(actions).toContain(ActivityActions.VALIDATION_COMPLETED);
    expect(actions).toContain(ActivityActions.DEDUPLICATION_COMPLETED);
    expect(actions).toContain(ActivityActions.RUN_COMPLETED);
  });

  it("handles cross-process event propagation and deduplication in WorkflowEventBroadcaster", async () => {
    const prisma = mockPrisma();

    // Mock Redis publisher & subscriber using EventEmitter
    const redisBus = new EventEmitter();
    const mockRedisPublisher = {
      status: "ready",
      publish: async (channel: string, message: string) => {
        redisBus.emit("message", channel, message);
        return 1;
      },
    };

    const mockRedisSubscriber = new EventEmitter() as EventEmitter & { status: string; subscribe: (c: string) => Promise<string>; unsubscribe: (c: string) => Promise<string> };
    mockRedisSubscriber.status = "ready";
    mockRedisSubscriber.subscribe = async (channel: string) => {
      redisBus.on("message", (chan, msg) => {
        if (chan === channel) mockRedisSubscriber.emit("message", chan, msg);
      });
      return "OK";
    };
    mockRedisSubscriber.unsubscribe = async () => "OK";

    const broadcaster = new WorkflowEventBroadcaster(prisma, {
      redisPublisher: mockRedisPublisher as never,
      redisSubscriber: mockRedisSubscriber as never,
    });

    const receivedEvents: RunActivityEvent[] = [];
    const unsubscribe = await broadcaster.subscribe(RUN_ID, (event) => {
      receivedEvents.push(event);
    });

    await broadcaster.recordAndBroadcast({
      workspaceId: WS,
      action: ActivityActions.SCRAPE_STARTED,
      entityType: "workflow_run",
      entityId: RUN_ID,
      details: { url: "https://example.com" },
    });

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]?.action).toBe(ActivityActions.SCRAPE_STARTED);

    await unsubscribe();
  });

  it("serves SSE on GET /api/v1/runs/:id/events with correct event-stream headers and history replay", async () => {
    const prisma = mockPrisma();
    const broadcaster = new WorkflowEventBroadcaster(prisma);

    // Pre-populate an activity event in MySQL
    await broadcaster.recordAndBroadcast({
      workspaceId: WS,
      action: ActivityActions.PLAN_CREATED,
      entityType: "workflow_run",
      entityId: RUN_ID,
      details: { version: 1 },
    });

    const historyRepo = new WorkflowHistoryRepository(prisma);
    const execRepo = new WorkflowExecutionRepository(prisma, broadcaster);

    const config = loadEnvConfig({ APP_ENV: "test", MYSQL_HOST: "localhost", MYSQL_PORT: "3306", MYSQL_USER: "aidp", MYSQL_PASSWORD: "", MYSQL_DATABASE: "aidp_test" });
    const app = createApp({
      config,
      logger: pino({ enabled: false }),
      requirementParser: { parse: async () => ({ validationStatus: "valid" } as never) },
      workflowPlanner: { plan: async () => ({} as never) },
      workflowExecution: { execute: async () => ({} as never) },
      workflowRunRepository: execRepo,
      workflowHistoryRepository: historyRepo,
      eventBroadcaster: broadcaster,
      agentAdapter: new MockAgentAdapter(),
      readiness: { mysql: async () => 1, redis: async () => "PONG" },
    });

    const res = await request(app)
      .get(`/api/v1/runs/${RUN_ID}/events?workspaceId=${WS}&userId=${USER}`)
      .expect(200);

    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.text).toContain(`event: ${ActivityActions.PLAN_CREATED}`);
    expect(res.text).toContain("version");
  });

  it("exposes GET /api/v1/workflows and GET /api/v1/runs/:id HTTP endpoints", async () => {
    const prisma = mockPrisma();
    const broadcaster = new WorkflowEventBroadcaster(prisma);
    const historyRepo = new WorkflowHistoryRepository(prisma);
    const execRepo = new WorkflowExecutionRepository(prisma, broadcaster);

    const config = loadEnvConfig({ APP_ENV: "test", MYSQL_HOST: "localhost", MYSQL_PORT: "3306", MYSQL_USER: "aidp", MYSQL_PASSWORD: "", MYSQL_DATABASE: "aidp_test" });
    const app = createApp({
      config,
      logger: pino({ enabled: false }),
      requirementParser: { parse: async () => ({ validationStatus: "valid" } as never) },
      workflowPlanner: { plan: async () => ({} as never) },
      workflowExecution: { execute: async () => ({} as never) },
      workflowRunRepository: execRepo,
      workflowHistoryRepository: historyRepo,
      eventBroadcaster: broadcaster,
      agentAdapter: new MockAgentAdapter(),
      readiness: { mysql: async () => 1, redis: async () => "PONG" },
    });

    // 1. GET /api/v1/workflows
    const wfRes = await request(app)
      .get(`/api/v1/workflows?workspaceId=${WS}&userId=${USER}`)
      .expect(200);
    expect(wfRes.body.items).toHaveLength(1);
    expect(wfRes.body.items[0].name).toBe("Extract Tech Companies");
    expect(wfRes.body.items[0].lastRun.recordsFound).toBe(50);
    expect(wfRes.body.items[0].numberOfRuns).toBe(2);

    // 2. GET /api/v1/workflows/:id
    const wfDetailRes = await request(app)
      .get(`/api/v1/workflows/${WF_ID}?workspaceId=${WS}&userId=${USER}`)
      .expect(200);
    expect(wfDetailRes.body.id).toBe(WF_ID);
    expect(wfDetailRes.body.latestPlan.version).toBe(1);

    // 3. GET /api/v1/runs/:id
    const runRes = await request(app)
      .get(`/api/v1/runs/${RUN_ID}?workspaceId=${WS}&userId=${USER}`)
      .expect(200);
    expect(runRes.body.id).toBe(RUN_ID);
    expect(runRes.body.recordsFound).toBe(50);
    expect(runRes.body.recordsAccepted).toBe(48);
    expect(runRes.body.duplicates).toBe(2);
    expect(runRes.body.duration).toBe(300000);
    expect(runRes.body.dataset.recordCount).toBe(48);
  });
});
