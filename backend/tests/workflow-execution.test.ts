import pino from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { AgentResult } from "../src/agent/types.js";
import { MockAgentAdapter } from "../src/agent/MockAgentAdapter.js";
import { loadEnvConfig } from "../src/config/env.js";
import { WorkflowExecutionService } from "../src/modules/workflows/workflow-execution.service.js";
import type { WorkflowPlanner } from "../src/modules/planner/planner.service.js";
import type { WorkflowPlan } from "../src/modules/planner/workflow-plan.schema.js";
import type { RequirementParser } from "../src/modules/requirements/parser.service.js";
import type { WorkflowExecutionStore } from "../src/db/repositories/workflow-execution.repository.js";

const workspaceId = "6ae1526d-29f8-46c6-85de-64f30e39b8d1";
const createdById = "70d47d9b-8ad1-4ce7-87a2-cb6b46e53ea4";
const parsedRequirement = {
  objective: "Find one public example company",
  entityType: "company", quantity: 1,
  geography: { places: [], scope: "unspecified", includeSubregions: null },
  timeRange: { field: null, after: null, before: null, on: null, expression: null },
  filters: [], constraints: [],
  fields: [{ key: "name", label: "Company name", type: "string", description: null }],
  requiredFields: ["name"], optionalFields: [], sourcePreferences: [], sourceRestrictions: [],
  deduplicationKeys: ["name"], validationRules: [], outputFormat: "json",
  ambiguities: [], missingInformation: [], warnings: [],
} as const;

describe("prompt-to-agent workflow flow", () => {
  it("runs parse → validated plan → mock Firecrawl adapter and returns normalized results", async () => {
    const calls: string[] = [];
    const parser: RequirementParser = {
      parse: async (prompt) => {
        calls.push("parse");
        expect(prompt).toBe("Find one public example company with name");
        return { parsedRequirement: parsedRequirement as unknown as Awaited<ReturnType<RequirementParser["parse"]>>["parsedRequirement"], validationStatus: "valid", warnings: [], missingInformation: [] };
      },
    };
    const plan = { version: 1, objective: "Research one public company" } as WorkflowPlan;
    const planner: WorkflowPlanner = {
      plan: async (input) => {
        calls.push("plan");
        expect(input.requirement).toEqual(parsedRequirement);
        return { workflowId: "bfb93d9b-9a5f-45ed-a78d-4f387358190b", plan, planningStatus: "PLANNED" };
      },
    };
    const mockResult: AgentResult = {
      status: "COMPLETED",
      data: { records: [{ values: { name: "Example Company" }, sourceUrls: ["https://company.example/"] }] },
      records: [{ values: { name: "Example Company" }, sourceUrls: ["https://company.example/"] }],
      sources: [{ url: "https://company.example/", canonicalUrl: "https://company.example/", domain: "company.example", title: "Example Company", sourceType: "scrape", retrievedAt: "2026-09-28T10:00:00.000Z", verifiedByTool: true }],
      execution: { provider: "mock", model: "mock-agent", startedAt: "2026-09-28T10:00:00.000Z", finishedAt: "2026-09-28T10:00:01.000Z", durationMs: 1_000, inputTokens: 10, outputTokens: 5, totalTokens: 15, toolCallCount: 2, toolsUsed: ["search", "scrape"] },
      events: [{ runId: "run-test", sequence: 1, type: "agent.completed", occurredAt: "2026-09-28T10:00:01.000Z", summary: "Agent completed" }],
      errors: [],
    };
    const adapter = new MockAgentAdapter(() => mockResult);
    const store: WorkflowExecutionStore & { created?: unknown; finalized?: AgentResult } = {
      createRun: async (input) => { calls.push("run"); store.created = input; return { id: "70d5eada-b995-49a5-b70b-6103d3a9a155" }; },
      completeRun: async (_runId, result) => { calls.push("persist"); store.finalized = result; },
    };
    const execution = new WorkflowExecutionService(parser, planner, adapter, store);
    const config = loadEnvConfig({ APP_ENV: "test", MYSQL_HOST: "localhost", MYSQL_PORT: "3306", MYSQL_USER: "aidp", MYSQL_PASSWORD: "", MYSQL_DATABASE: "aidp_test" });
    const app = createApp({
      config,
      logger: pino({ enabled: false }),
      requirementParser: parser,
      workflowPlanner: planner,
      workflowExecution: execution,
      agentAdapter: adapter,
      readiness: { mysql: async () => 1, redis: async () => "PONG" },
    });

    const response = await request(app).post("/api/v1/workflows/execute").send({
      prompt: "Find one public example company with name", workspaceId, createdById,
    });
    expect(response.status).toBe(200);
    expect(calls).toEqual(["parse", "plan", "run", "persist"]);
    expect(response.body.workflowId).toBe("bfb93d9b-9a5f-45ed-a78d-4f387358190b");
    expect(response.body.runId).toBe("70d5eada-b995-49a5-b70b-6103d3a9a155");
    expect(response.body.result.records[0].values.name).toBe("Example Company");
    expect(response.body.result.sources[0].verifiedByTool).toBe(true);
    expect(adapter.inputs[0]?.plan).toBe(plan);
    expect(store.finalized?.status).toBe("COMPLETED");
  });

  it("stops before workflow planning and collection when requirements need clarification", async () => {
    let plannerCalled = false;
    const parser: RequirementParser = {
      parse: async () => ({ parsedRequirement: parsedRequirement as unknown as Awaited<ReturnType<RequirementParser["parse"]>>["parsedRequirement"], validationStatus: "needs_clarification", warnings: [], missingInformation: ["Which entity?"] }),
    };
    const planner: WorkflowPlanner = { plan: async () => { plannerCalled = true; throw new Error("must not be called"); } };
    const adapter = new MockAgentAdapter();
    const store: WorkflowExecutionStore = { createRun: async () => { throw new Error("must not be called"); }, completeRun: async () => undefined };
    const execution = new WorkflowExecutionService(parser, planner, adapter, store);
    await expect(execution.execute({ prompt: "Find something", workspaceId, createdById })).rejects.toMatchObject({ code: "REQUIREMENT_NEEDS_CLARIFICATION", statusCode: 422 });
    expect(plannerCalled).toBe(false);
    expect(adapter.inputs).toHaveLength(0);
  });
});

