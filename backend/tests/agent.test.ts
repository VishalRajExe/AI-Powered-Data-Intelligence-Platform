import pino from "pino";
import { describe, expect, it } from "vitest";
import type { CreateAgentOptions, RunParams } from "@aidp/firecrawl-agent-core";
import { AgentEventMapper } from "../src/agent/AgentEventMapper.js";
import { AgentResultNormalizer } from "../src/agent/AgentResultNormalizer.js";
import { FirecrawlAgentAdapter, type FirecrawlAgentFactory } from "../src/agent/FirecrawlAgentAdapter.js";
import { MockAgentAdapter } from "../src/agent/MockAgentAdapter.js";
import { loadEnvConfig } from "../src/config/env.js";
import type { WorkflowPlan } from "../src/modules/planner/workflow-plan.schema.js";

const plan = makePlan();
const now = new Date("2026-09-28T10:00:00.000Z");

function makeConfig(withKeys = true) {
  return loadEnvConfig({
    APP_ENV: "test", MYSQL_HOST: "localhost", MYSQL_PORT: "3306", MYSQL_USER: "aidp", MYSQL_PASSWORD: "", MYSQL_DATABASE: "aidp_test",
    LLM_PROVIDER: "google", LLM_MODEL_ID: "gemini-test",
    ...(withKeys ? { FIRECRAWL_API_KEY: "fc-test-key", GOOGLE_GENERATIVE_AI_API_KEY: "google-test-key" } : {}),
  });
}

function makePlan(): WorkflowPlan {
  const requirement: WorkflowPlan["requirement"] = {
    objective: "Collect an example public company name and website",
    entityType: "company", quantity: 1,
    geography: { places: [], scope: "unspecified", includeSubregions: null },
    timeRange: { field: null, after: null, before: null, on: null, expression: null },
    filters: [], constraints: [],
    fields: [{ key: "name", label: "Company name", type: "string", description: null }],
    requiredFields: ["name"], optionalFields: [], sourcePreferences: [], sourceRestrictions: [],
    deduplicationKeys: ["name"], validationRules: [], outputFormat: "unspecified",
    ambiguities: [], missingInformation: [], warnings: [],
  };
  const retryPolicy = { maxAttempts: 2, backoff: "exponential" as const, initialDelayMs: 300, multiplier: 2, maxDelayMs: 2_000, retryableErrors: ["TIMEOUT" as const] };
  return {
    version: 1,
    requirement,
    objective: requirement.objective!,
    constraints: [],
    sourcePolicy: {
      permittedSourceTypes: ["official_website"], allowedDomains: [], preferredDomains: [], blockedDomains: ["blocked.example"],
      respectRobotsTxt: true, respectSiteTerms: true, allowAuthentication: false, allowCaptchaBypass: false,
      maxRequestsPerDomainPerMinute: 5, policyRationale: "Only use public official sources.",
    },
    searchStrategy: { queries: [{ query: "example public company", sourceType: "official_website", rationale: "Locate its official homepage." }], desiredSourceCount: 1, maximumSourceCount: 3, selectionRationale: "One primary source is sufficient." },
    steps: [
      { id: "find-site", type: "SEARCH", description: "Find the official company website.", input: {}, configuration: {}, dependencies: [], retryPolicy, timeoutMs: 20_000, expectedOutput: "Official company website URL", status: "PENDING" },
      { id: "scrape-site", type: "SCRAPE", description: "Read public company details.", input: {}, configuration: {}, dependencies: ["find-site"], retryPolicy, timeoutMs: 20_000, expectedOutput: "Company name and public source evidence", status: "PENDING" },
      { id: "interact-page", type: "INTERACT", description: "Use browser interaction only if needed for public content.", input: {}, configuration: {}, dependencies: ["scrape-site"], retryPolicy, timeoutMs: 20_000, expectedOutput: "Any public interactive page content", status: "PENDING" },
      { id: "extract-record", type: "EXTRACT", description: "Extract the company name.", input: {}, configuration: {}, dependencies: ["interact-page"], retryPolicy, timeoutMs: 20_000, expectedOutput: "Structured company row", status: "PENDING" },
      { id: "save-record", type: "SAVE", description: "Save the extracted result.", input: {}, configuration: {}, dependencies: ["extract-record"], retryPolicy, timeoutMs: 20_000, expectedOutput: "Workflow run result", status: "PENDING" },
    ],
    extractionSchema: { type: "object", properties: { name: { type: "string", description: "Company name" } }, required: ["name"], additionalProperties: false },
    transformations: [],
    validationRules: [{ fieldKey: "name", rule: "REQUIRED", severity: "ERROR", description: "Company name is required." }],
    deduplicationRules: [{ keys: ["name"], strategy: "NORMALIZED", confidenceThreshold: 1, ambiguousMatchAction: "KEEP_SEPARATE", rationale: "Normalize company name." }],
    completionCriteria: { targetRecordCount: 1, minimumSources: 1, requiredFieldsPresent: ["name"], requireSourceEvidence: true, stopWhenTargetReached: true, allowPartialResults: true, completionDescription: "Return one sourced company record." },
    outputConfiguration: { format: "json", expectedColumns: ["name"], includeSourceEvidence: true },
  };
}

describe("Agent Core integration adapters", () => {
  it("checks configuration without exposing secret values", () => {
    const adapter = new FirecrawlAgentAdapter(makeConfig(false), pino({ enabled: false }));
    expect(adapter.checkConfiguration()).toEqual({
      configured: false,
      provider: "google",
      model: "gemini-test",
      missing: ["FIRECRAWL_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    });
  });

  it("enables only plan-approved Firecrawl tools, blocks excluded hosts, streams events, and normalizes the result", async () => {
    let capturedOptions: CreateAgentOptions | undefined;
    let capturedPrompt: RunParams | undefined;
    let blockedResponse: unknown;
    const scrapedUrl = "https://company.example/about";
    const resultText = JSON.stringify({ records: [{ values: { name: "Example Company" }, sourceUrls: [scrapedUrl] }] });
    const searchStep = {
      text: "",
      toolCalls: [{ name: "search", input: { query: "example public company" } }],
      toolResults: [{ name: "search", output: { web: [{ title: "Example Company", url: scrapedUrl, description: "Official website" }] } }],
    };
    const scrapeStep = {
      text: "",
      toolCalls: [{ name: "scrape", input: { url: scrapedUrl } }],
      toolResults: [{ name: "scrape", output: { url: scrapedUrl, markdown: "Example Company", metadata: { title: "Example Company", description: "Official company homepage" } } }],
    };
    const factory: FirecrawlAgentFactory = (options) => {
      capturedOptions = options;
      return {
        async *stream(params) {
          capturedPrompt = params;
          const toolkit = options.toolkit!;
          const scrapeTool = toolkit.tools.scrape as unknown as { execute(input: unknown): Promise<unknown> };
          blockedResponse = await scrapeTool.execute({ url: "https://blocked.example/private" });
          yield { type: "tool-call", toolName: "search", input: { query: "example public company" } };
          yield { type: "tool-result", toolName: "search", output: searchStep.toolResults[0]!.output };
          yield { type: "tool-call", toolName: "scrape", input: { url: scrapedUrl } };
          yield { type: "tool-result", toolName: "scrape", output: scrapeStep.toolResults[0]!.output };
          yield {
            type: "done",
            text: resultText,
            steps: [searchStep, scrapeStep],
            durationMs: 1_500,
            model: "google:gemini-test",
            usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
          };
        },
      };
    };
    const adapter = new FirecrawlAgentAdapter(makeConfig(), pino({ enabled: false }), factory);
    const receivedEvents: unknown[] = [];
    const result = await adapter.execute({ prompt: "Find one public company name", plan, runId: "test-run", onEvent: (event) => receivedEvents.push(event) });

    expect(adapter.checkConfiguration().configured).toBe(true);
    expect(blockedResponse).toEqual({ error: "SOURCE_BLOCKED_BY_POLICY" });
    expect(capturedOptions?.firecrawlOptions).toMatchObject({ search: { excludeDomains: ["blocked.example"] }, map: false, crawl: false });
    expect(Object.keys(capturedOptions?.toolkit?.tools ?? {}).sort()).toEqual(["interact", "scrape", "search"]);
    expect(capturedPrompt?.schema).toMatchObject({ properties: { records: { type: "array" } } });
    expect(capturedPrompt?.skills).toContain("structured-extraction");
    expect(result.status).toBe("COMPLETED");
    expect(result.records).toEqual([{ values: { name: "Example Company" }, sourceUrls: [scrapedUrl] }]);
    expect(result.sources.some((source) => source.domain === "company.example" && source.verifiedByTool)).toBe(true);
    expect(result.execution).toMatchObject({ model: "google:gemini-test", durationMs: 1_500, totalTokens: 200, toolCallCount: 2 });
    expect(result.events.map(({ type }) => type)).toContain("agent.tool.started");
    expect(receivedEvents).toHaveLength(result.events.length);
    expect(JSON.stringify(result)).not.toContain("fc-test-key");
  });

  it("normalizes schema mismatch and sources reported only by the model as unverified", () => {
    const normalizer = new AgentResultNormalizer();
    const result = normalizer.normalize({
      text: JSON.stringify({ records: [{ values: { name: "Reported Co" }, sourceUrls: ["https://made-up.example/source"] }] }),
      steps: [], provider: "google", startedAt: now, finishedAt: now,
      schemaMismatch: { missing: ["records[0].sourceUrls"], extra: [] },
    });
    expect(result.status).toBe("PARTIAL");
    expect(result.sources[0]?.verifiedByTool).toBe(false);
    expect(result.records[0]?.sourceUrls).toEqual([]);
    expect(result.errors.map(({ code }) => code)).toContain("OUTPUT_SCHEMA_MISMATCH");
  });

  it("maps Agent Core events without including raw page bodies", () => {
    const mapper = new AgentEventMapper(() => now);
    const event = mapper.map({ type: "tool-result", toolName: "scrape", output: { markdown: "Private body text", url: "https://company.example" } }, "run-2", 3);
    expect(event).toMatchObject({ runId: "run-2", sequence: 3, type: "agent.tool.completed", workflowStepType: "SCRAPE" });
    expect(JSON.stringify(event)).not.toContain("Private body text");
  });

  it("keeps mock execution local and deterministic for tests", async () => {
    const mock = new MockAgentAdapter();
    const output = await mock.execute({ prompt: "Find a company", plan });
    expect(mock.checkConfiguration().provider).toBe("mock");
    expect(output.status).toBe("COMPLETED");
    expect(mock.inputs).toHaveLength(1);
  });
});
