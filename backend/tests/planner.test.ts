import pino from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnvConfig } from "../src/config/env.js";
import { WorkflowPlannerService } from "../src/modules/planner/planner.service.js";
import { PlanWorkflowRequestSchema, WorkflowPlanDraftSchema, type PlanWorkflowRequest, type WorkflowPlan, type WorkflowPlanDraft, type WorkflowStep } from "../src/modules/planner/workflow-plan.schema.js";
import type { WorkflowPlanProvider } from "../src/modules/planner/provider.js";
import type { WorkflowPlannerStore } from "../src/db/repositories/workflow-planner.repository.js";

const workspaceId = "6ae1526d-29f8-46c6-85de-64f30e39b8d1";
const createdById = "70d47d9b-8ad1-4ce7-87a2-cb6b46e53ea4";

const requirement: PlanWorkflowRequest["requirement"] = {
  objective: "Collect current job openings at research organizations",
  entityType: "job posting",
  quantity: 25,
  geography: { places: ["India"], scope: "country", includeSubregions: true },
  timeRange: { field: "posted_date", after: null, before: null, on: null, expression: "currently open" },
  filters: [], constraints: [],
  fields: [
    { key: "title", label: "Job title", type: "string", description: null },
    { key: "company", label: "Company", type: "string", description: null },
  ],
  requiredFields: ["title", "company"], optionalFields: [],
  sourcePreferences: [], sourceRestrictions: [], deduplicationKeys: ["title", "company"],
  validationRules: [], outputFormat: "unspecified", ambiguities: [], missingInformation: [], warnings: [],
};

const requestBody: PlanWorkflowRequest = { workspaceId, createdById, requirement, originalPrompt: "Find 25 open jobs in India with title and company" };

function makePlan(entity = "job posting"): WorkflowPlanDraft {
  return {
    objective: `Collect ${entity} records`,
    constraints: ["Collect only from public sources"],
    sourcePolicy: {
      permittedSourceTypes: ["job_board", "official_website"], allowedDomains: [], preferredDomains: [], blockedDomains: [],
      respectRobotsTxt: true, respectSiteTerms: true, allowAuthentication: false, allowCaptchaBypass: false,
      maxRequestsPerDomainPerMinute: 10, policyRationale: "Use public job board pages within site policies.",
    },
    searchStrategy: {
      queries: [{ query: "open research organization jobs India", sourceType: "job_board", rationale: "Locate current listings." }],
      desiredSourceCount: 5, maximumSourceCount: 10, selectionRationale: "Several relevant boards provide coverage.",
    },
    steps: [
      { id: "search-jobs", type: "SEARCH", description: "Find permitted job listing sources.", input: {}, configuration: {}, dependencies: [], retryPolicy: retryPolicy(), timeoutMs: 30_000, expectedOutput: "Candidate public source URLs", status: "PENDING" },
      { id: "extract-jobs", type: "EXTRACT", description: "Extract job title and organization.", input: {}, configuration: {}, dependencies: ["search-jobs"], retryPolicy: retryPolicy(), timeoutMs: 30_000, expectedOutput: "Structured job records with evidence", status: "PENDING" },
      { id: "save-jobs", type: "SAVE", description: "Persist validated job records.", input: {}, configuration: {}, dependencies: ["extract-jobs"], retryPolicy: retryPolicy(), timeoutMs: 30_000, expectedOutput: "Persisted dataset", status: "PENDING" },
    ],
    extractionSchema: {
      type: "object", additionalProperties: false, required: ["title", "company"],
      properties: {
        title: { type: "string", description: "Job title" },
        company: { type: "string", description: "Hiring organization" },
      },
    },
    transformations: [],
    validationRules: [{ fieldKey: "title", rule: "REQUIRED", severity: "ERROR", description: "Job title must be present." }],
    deduplicationRules: [{ keys: ["title", "company"], strategy: "NORMALIZED", confidenceThreshold: 1, ambiguousMatchAction: "KEEP_SEPARATE", rationale: "Match normalized title and hiring organization." }],
    completionCriteria: {
      targetRecordCount: 25, minimumSources: 1, requiredFieldsPresent: ["title", "company"], requireSourceEvidence: true,
      stopWhenTargetReached: true, allowPartialResults: true, completionDescription: "Stop at 25 records or after all selected sources are exhausted.",
    },
    outputConfiguration: { format: "unspecified", expectedColumns: ["title", "company"], includeSourceEvidence: true },
  };
}

function retryPolicy(): WorkflowStep["retryPolicy"] {
  return { maxAttempts: 3, backoff: "exponential", initialDelayMs: 500, multiplier: 2, maxDelayMs: 5_000, retryableErrors: ["TIMEOUT", "RATE_LIMIT"] };
}

class FakeStore implements WorkflowPlannerStore {
  created = 0;
  saved: WorkflowPlan | undefined;
  failed: { code: string; message: string } | undefined;
  async createPlanningWorkflow() { this.created += 1; return { id: "1d48ec33-a68e-4b73-9073-448d4ab18fdb" }; }
  async savePlan(_workflowId: string, _workspaceId: string, _requirement: PlanWorkflowRequest["requirement"], plan: WorkflowPlan) { this.saved = plan; }
  async markPlanningFailed(_workflowId: string, code: string, message: string) { this.failed = { code, message }; }
}

function makeService(outputs: unknown[], store = new FakeStore()) {
  const calls: Array<string[] | undefined> = [];
  const provider: WorkflowPlanProvider = {
    generatePlan: async (_requirement, correction) => { calls.push(correction); return outputs.shift(); },
  };
  return { service: new WorkflowPlannerService(provider, store, pino({ enabled: false })), store, calls };
}

describe("workflow planning", () => {
  it("validates and persists a typed plan while binding the exact requirement", async () => {
    const { service, store, calls } = makeService([makePlan()]);
    const result = await service.plan(requestBody);
    expect(result.planningStatus).toBe("PLANNED");
    expect(result.plan.version).toBe(1);
    expect(result.plan.requirement).toEqual(requirement);
    expect(store.saved).toEqual(result.plan);
    expect(store.failed).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("supports requirement-specific plans instead of a fixed step sequence", () => {
    const jobs = makePlan("job posting");
    const market = makePlan("market data");
    market.steps = [
      { ...jobs.steps[0]!, id: "research-sources", type: "SEARCH", description: "Find official and research market sources." },
      { ...jobs.steps[1]!, id: "extract-market", description: "Extract dated market indicators with evidence.", dependencies: ["research-sources"] },
      { ...jobs.steps[1]!, id: "cross-check", type: "VALIDATE", description: "Cross-check market figures across permitted sources.", dependencies: ["extract-market"] },
      { ...jobs.steps[2]!, id: "save-market", dependencies: ["cross-check"] },
    ];
    expect(WorkflowPlanDraftSchema.safeParse(jobs).success).toBe(true);
    expect(WorkflowPlanDraftSchema.safeParse(market).success).toBe(true);
    expect(market.steps.map(({ type }) => type)).not.toEqual(jobs.steps.map(({ type }) => type));
  });

  it.each([
    ["malformed plan", () => ({ ...makePlan(), objective: "" })],
    ["unsupported step", () => ({ ...makePlan(), steps: makePlan().steps.map((step, index) => index === 0 ? { ...step, type: "CRAWL_WITH_SHELL" } : step) })],
    ["missing extraction schema", () => { const value = makePlan(); delete (value as Partial<WorkflowPlanDraft>).extractionSchema; return value; }],
    ["invalid retry policy", () => ({ ...makePlan(), steps: makePlan().steps.map((step, index) => index === 0 ? { ...step, retryPolicy: { ...retryPolicy(), maxAttempts: 9 } } : step) })],
    ["missing completion criteria", () => { const value = makePlan(); delete (value as Partial<WorkflowPlanDraft>).completionCriteria; return value; }],
  ])("rejects %s and requests one corrected plan", async (_label, invalidPlan) => {
    const malformed = invalidPlan();
    expect(WorkflowPlanDraftSchema.safeParse(malformed).success).toBe(false);
    const { service, store, calls } = makeService([malformed, makePlan()]);
    const result = await service.plan(requestBody);
    expect(result.planningStatus).toBe("PLANNED");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.length).toBeGreaterThan(0);
    expect(store.saved).toBeDefined();
  });

  it("persists planning failure after the correction attempt is also invalid", async () => {
    const { service, store, calls } = makeService([{ ...makePlan(), steps: [] }, { ...makePlan(), steps: [] }]);
    await expect(service.plan(requestBody)).rejects.toMatchObject({ code: "INVALID_WORKFLOW_PLAN", statusCode: 502 });
    expect(calls).toHaveLength(2);
    expect(store.failed?.code).toBe("INVALID_WORKFLOW_PLAN");
    expect(store.saved).toBeUndefined();
  });

  it("does not create a workflow for requirements that still need clarification", async () => {
    const store = new FakeStore();
    const { service } = makeService([makePlan()], store);
    await expect(service.plan({ ...requestBody, requirement: { ...requirement, ambiguities: [{ topic: "time", question: "Which dates?", context: null }] } }))
      .rejects.toMatchObject({ code: "REQUIREMENT_NEEDS_CLARIFICATION", statusCode: 422 });
    expect(store.created).toBe(0);
  });

  it("validates the planning API request and returns the persisted plan", async () => {
    const { service } = makeService([makePlan()]);
    const config = loadEnvConfig({ APP_ENV: "test", MYSQL_HOST: "localhost", MYSQL_PORT: "3306", MYSQL_USER: "aidp", MYSQL_PASSWORD: "", MYSQL_DATABASE: "aidp_test" });
    const app = createApp({
      config, logger: pino({ enabled: false }), workflowPlanner: service,
      workflowExecution: { execute: async () => { throw new Error("Workflow execution not used in this test"); } },
      agentAdapter: { checkConfiguration: () => ({ configured: true, provider: "mock", model: "mock", missing: [] }), execute: async () => { throw new Error("Agent not used in this test"); } },
      requirementParser: { parse: async () => { throw new Error("not used"); } },
      readiness: { mysql: async () => 1, redis: async () => "PONG" },
    });
    const invalid = await request(app).post("/api/v1/workflows/plan").send({ workspaceId, createdById, requirement: {} });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
    const valid = await request(app).post("/api/v1/workflows/plan").send(requestBody);
    expect(valid.status).toBe(201);
    expect(valid.body.plan.steps.map((step: { type: string }) => step.type)).toContain("EXTRACT");
  });

  it("rejects a plan that omits a requested extraction field", () => {
    const plan = makePlan();
    delete (plan.extractionSchema.properties as Record<string, unknown>).company;
    expect(WorkflowPlanDraftSchema.safeParse(plan).success).toBe(false);
    expect(PlanWorkflowRequestSchema.safeParse(requestBody).success).toBe(true);
  });
});
