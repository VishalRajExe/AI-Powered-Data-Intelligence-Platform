import pino from "pino";
import { describe, expect, it } from "vitest";
import { FirecrawlAgentAdapter } from "../src/agent/FirecrawlAgentAdapter.js";
import { loadEnvConfig } from "../src/config/env.js";
import { WorkflowPlanSchema } from "../src/modules/planner/workflow-plan.schema.js";

const config = loadEnvConfig({
  ...process.env,
  APP_ENV: "test",
  MYSQL_HOST: process.env.MYSQL_HOST ?? "localhost",
  MYSQL_PORT: process.env.MYSQL_PORT ?? "3306",
  MYSQL_USER: process.env.MYSQL_USER ?? "test",
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD ?? "",
  MYSQL_DATABASE: process.env.MYSQL_DATABASE ?? "aidp_test",
});
const integrationEnabled = process.env.RUN_FIRECRAWL_INTEGRATION_TESTS === "true" &&
  Boolean(config.FIRECRAWL_API_KEY && config.LLM_MODEL_ID && configuredProviderKey(config));

describe.skipIf(!integrationEnabled)("Firecrawl Agent Core live integration", () => {
  it("searches and returns schema-valid source-backed structured output", async () => {
    const plan = WorkflowPlanSchema.parse({
      version: 1,
      objective: "Find the official Firecrawl website and its page title.",
      requirement: {
        objective: "Find the official Firecrawl website and its page title.", entityType: "company", quantity: 1,
        geography: { places: [], scope: "unspecified", includeSubregions: null },
        timeRange: { field: null, after: null, before: null, on: null, expression: null },
        filters: [], constraints: [],
        fields: [{ key: "name", label: "Company name", type: "string", description: "Official company name" }],
        requiredFields: ["name"], optionalFields: [], sourcePreferences: [], sourceRestrictions: [],
        deduplicationKeys: ["name"], validationRules: [], outputFormat: "json",
        ambiguities: [], missingInformation: [], warnings: [],
      },
      constraints: [],
      sourcePolicy: {
        permittedSourceTypes: ["official_website", "other"], preferredDomains: ["firecrawl.dev"], blockedDomains: [],
        respectRobotsTxt: true, respectSiteTerms: true, allowAuthentication: false, allowCaptchaBypass: false,
        maxRequestsPerDomainPerMinute: 4, policyRationale: "Use only public official website material.",
      },
      searchStrategy: {
        queries: [{ query: "Firecrawl official website", sourceType: "official_website", rationale: "Find the official public company site." }],
        desiredSourceCount: 1, maximumSourceCount: 2, selectionRationale: "One official source is sufficient.",
      },
      steps: [
        step("search", "SEARCH", "Find the official public website."),
        step("extract", "EXTRACT", "Extract the company name."),
        step("save", "SAVE", "Return structured data with source evidence."),
      ],
      extractionSchema: {
        type: "object", properties: { name: { type: "string", description: "Official company name" } },
        required: ["name"], additionalProperties: false,
      },
      transformations: [],
      validationRules: [{ fieldKey: "name", rule: "REQUIRED", severity: "ERROR", description: "Company name is required." }],
      deduplicationRules: [{ keys: ["name"], strategy: "NORMALIZED", confidenceThreshold: 0.95, ambiguousMatchAction: "KEEP_SEPARATE", rationale: "Normalize exact company-name variants." }],
      completionCriteria: {
        targetRecordCount: 1, minimumSources: 1, requiredFieldsPresent: ["name"], requireSourceEvidence: true,
        stopWhenTargetReached: true, allowPartialResults: true, completionDescription: "Return up to one sourced official company name.",
      },
      outputConfiguration: { format: "json", expectedColumns: ["name"], includeSourceEvidence: true },
    });

    const adapter = new FirecrawlAgentAdapter(config, pino({ enabled: false }));
    const result = await adapter.execute({
      prompt: "Find the official Firecrawl website and return its company name.",
      plan,
    });

    expect(["COMPLETED", "PARTIAL"]).toContain(result.status);
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records[0]?.values.name).toEqual(expect.any(String));
    expect(result.sources.some((source) => source.verifiedByTool)).toBe(true);
  }, 120_000);
});

function configuredProviderKey(value: ReturnType<typeof loadEnvConfig>): string | undefined {
  return {
    google: value.GOOGLE_GENERATIVE_AI_API_KEY,
    anthropic: value.ANTHROPIC_API_KEY,
    openai: value.OPENAI_API_KEY,
    gateway: value.AI_GATEWAY_API_KEY,
    "custom-openai": value.CUSTOM_OPENAI_API_KEY,
  }[value.LLM_PROVIDER];
}

function step(id: string, type: "SEARCH" | "EXTRACT" | "SAVE", description: string) {
  return {
    id, type, description, input: {}, configuration: {}, dependencies: [],
    retryPolicy: { maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [] },
    timeoutMs: 30_000, expectedOutput: description, status: "PENDING" as const,
  };
}
