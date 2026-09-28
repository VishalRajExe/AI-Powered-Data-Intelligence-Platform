import pino from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { MockAgentAdapter } from "../src/agent/MockAgentAdapter.js";
import { loadEnvConfig } from "../src/config/env.js";
import { WorkflowExecutionService } from "../src/modules/workflows/workflow-execution.service.js";
import type { WorkflowPlanner } from "../src/modules/planner/planner.service.js";
import type { WorkflowPlan } from "../src/modules/planner/workflow-plan.schema.js";
import type { RequirementParser } from "../src/modules/requirements/parser.service.js";

const workspaceId = "6ae1526d-29f8-46c6-85de-64f30e39b8d1";
const createdById = "70d47d9b-8ad1-4ce7-87a2-cb6b46e53ea4";
const parsedRequirement = {
  objective: "Find one public example company", entityType: "company", quantity: 1,
  geography: { places: [], scope: "unspecified", includeSubregions: null },
  timeRange: { field: null, after: null, before: null, on: null, expression: null }, filters: [], constraints: [],
  fields: [{ key: "name", label: "Company name", type: "string", description: null }], requiredFields: ["name"], optionalFields: [],
  sourcePreferences: [], sourceRestrictions: [], deduplicationKeys: ["name"], validationRules: [], outputFormat: "json",
  ambiguities: [], missingInformation: [], warnings: [],
} as const;

describe("queued workflow execution", () => {
  it("validates requirement and plan, persists a pending run, then enqueues it without doing web work in the request", async () => {
    const calls: string[] = [];
    const parser: RequirementParser = { parse: async () => ({ parsedRequirement: parsedRequirement as never, validationStatus: "valid", warnings: [], missingInformation: [] }) };
    const plan = { version: 1, objective: "Research one public company" } as WorkflowPlan;
    const planner: WorkflowPlanner = { plan: async () => ({ workflowId: "bfb93d9b-9a5f-45ed-a78d-4f387358190b", plan, planningStatus: "PLANNED" }) };
    const mockAgent = new MockAgentAdapter();
    const store = {
      createRun: async () => { calls.push("persist-run"); return { id: "70d5eada-b995-49a5-b70b-6103d3a9a155" }; },
      failRun: async () => { calls.push("mark-failed"); },
    };
    const queue = { add: async (_name: string, data: { runId: string }) => { calls.push(`enqueue:${data.runId}`); return {} as never; } };
    const execution = new WorkflowExecutionService(parser, planner, store, queue);
    const config = loadEnvConfig({ APP_ENV: "test", MYSQL_HOST: "localhost", MYSQL_PORT: "3306", MYSQL_USER: "aidp", MYSQL_PASSWORD: "", MYSQL_DATABASE: "aidp_test" });
    const app = createApp({ config, logger: pino({ enabled: false }), requirementParser: parser, workflowPlanner: planner,
      workflowExecution: execution, agentAdapter: mockAgent, readiness: { mysql: async () => 1, redis: async () => "PONG" } });

    const response = await request(app).post("/api/v1/workflows/execute").send({ prompt: "Find one public example company with name", workspaceId, createdById });
    expect(response.status).toBe(202);
    expect(response.body.status).toBe("PENDING");
    expect(response.body.runId).toBe("70d5eada-b995-49a5-b70b-6103d3a9a155");
    expect(calls).toEqual(["persist-run", `enqueue:${response.body.runId}`]);
    expect(mockAgent.inputs).toHaveLength(0);
  });

  it("stops before planning or enqueue when requirement needs clarification", async () => {
    let plannerCalled = false;
    const parser: RequirementParser = { parse: async () => ({ parsedRequirement: parsedRequirement as never, validationStatus: "needs_clarification", warnings: [], missingInformation: ["Which entity?"] }) };
    const planner: WorkflowPlanner = { plan: async () => { plannerCalled = true; throw new Error("must not be called"); } };
    const store = { createRun: async () => { throw new Error("must not be called"); }, failRun: async () => undefined };
    const queue = { add: async () => { throw new Error("must not be called"); } };
    const execution = new WorkflowExecutionService(parser, planner, store, queue);
    await expect(execution.execute({ prompt: "Find something", workspaceId, createdById })).rejects.toMatchObject({ code: "REQUIREMENT_NEEDS_CLARIFICATION", statusCode: 422 });
    expect(plannerCalled).toBe(false);
  });
});
