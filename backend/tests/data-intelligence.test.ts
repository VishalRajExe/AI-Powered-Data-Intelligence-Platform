import { describe, expect, it } from "vitest";
import type { AgentRecord, AgentResult } from "../src/agent/types.js";
import type { WorkflowPlan } from "../src/modules/planner/workflow-plan.schema.js";
import { DataQualityService } from "../src/modules/data-intelligence/DataQualityService.js";
import { EntityResolutionService } from "../src/modules/data-intelligence/EntityResolutionService.js";
import { NormalizationService } from "../src/modules/data-intelligence/NormalizationService.js";
import { ValidationService } from "../src/modules/data-intelligence/ValidationService.js";

const basePlan = {
  version: 1,
  objective: "Collect public company records",
  requirement: { requiredFields: ["company_name", "founder"] },
  constraints: [],
  sourcePolicy: { preferredDomains: [] },
  searchStrategy: { queries: [{ query: "AI companies India founders", sourceType: "research" }], maximumSourceCount: 20 },
  steps: [],
  extractionSchema: {
    type: "object",
    additionalProperties: false,
    required: ["company_name", "founder"],
    properties: {
      company_name: { type: "string", description: "Company name" },
      founder: { type: "string", description: "Founder name" },
      website: { type: "string", description: "Company website", format: "uri" },
      email: { type: "string", description: "Contact email", format: "email" },
      phone: { type: "string", description: "Contact phone" },
      founded_date: { type: "string", description: "Founded date", format: "date" },
      funding: { type: "string", description: "Funding amount" },
      country: { type: "string", description: "Country" },
      category: { type: "string", description: "Category", enum: ["technology", "finance"] },
    },
  },
  transformations: [],
  validationRules: [{ fieldKey: "company_name", rule: "REQUIRED", severity: "ERROR", description: "Company name is required." }],
  deduplicationRules: [{ keys: ["website"], strategy: "NORMALIZED", confidenceThreshold: 0.9, ambiguousMatchAction: "REVIEW", rationale: "Same canonical website identifies a source record." }],
  completionCriteria: {},
  outputConfiguration: {},
} as unknown as WorkflowPlan;

function source(url: string, domain?: string) {
  const parsed = new URL(url);
  return { url, canonicalUrl: url, domain: domain ?? parsed.hostname, sourceType: "scrape" as const, retrievedAt: "2026-09-28T10:00:00.000Z", verifiedByTool: true };
}

function result(records: AgentRecord[], sources?: AgentResult["sources"]): AgentResult {
  const now = new Date("2026-09-28T10:00:00.000Z").toISOString();
  const resolvedSources = sources ?? [...new Set(records.flatMap((record) => record.sourceUrls))].map((url) => source(url));
  return {
    status: "COMPLETED", data: null, records, sources: resolvedSources,
    execution: { provider: "mock", model: "mock", startedAt: now, finishedAt: now, durationMs: 1, inputTokens: 0, outputTokens: 0, totalTokens: 0, toolCallCount: 0, toolsUsed: [] },
    events: [], errors: [],
  };
}

describe("data intelligence pipeline", () => {
  it("normalizes aliases, whitespace, URLs, phone, currency, dates, country codes, and empty values while retaining raw values", () => {
    const raw = {
      Company: "  Acme   Inc. ",
      Website: "HTTPS://WWW.Acme.example/company/#team",
      "Contact Phone": "+1 (415) 555-0100",
      "Founded Date": "2021-02-03",
      Funding: "$1.2 million",
      Country: "IN",
      email: " Founder@Example.COM ",
      category: "technology",
      notes: "  N/A ",
    };
    const plan = { ...basePlan, extractionSchema: { ...basePlan.extractionSchema, properties: { ...basePlan.extractionSchema.properties, notes: { type: "string", description: "Notes" } } } } as WorkflowPlan;
    const normalized = new NormalizationService().normalize(result([{ values: raw, sourceUrls: ["https://acme.example/source"] }]), plan).records[0]!;
    expect(normalized.values.company_name).toBe("Acme Inc.");
    expect(normalized.values.website).toBe("https://www.acme.example/company");
    expect(normalized.values.phone).toBe("+14155550100");
    expect(normalized.values.founded_date).toBe("2021-02-03");
    expect(normalized.values.funding).toBe("USD 1200000");
    expect(normalized.values.country).toBe("India");
    expect(normalized.values.email).toBe("founder@example.com");
    expect(normalized.values.notes).toBeNull();
    expect(normalized.rawValues).toEqual(raw);
    expect(normalized.quality?.verificationState).toBe("UNSUPPORTED");
  });

  it("flags malformed URL/email/date, missing required fields, invalid enums, and unknown countries", () => {
    const raw = {
      company_name: "Broken Co",
      founder: null,
      website: "http://[invalid",
      email: "not-an-email",
      founded_date: "2024-02-31",
      country: "Atlantis",
      category: "robotics",
    };
    const pipeline = new DataQualityService().process(result([{ values: raw, sourceUrls: ["https://acme.example/source"] }]), basePlan);
    const record = pipeline.records[0]!;
    expect(record.isValid).toBe(false);
    expect(record.validationIssues?.map((issue) => issue.ruleCode)).toEqual(expect.arrayContaining(["REQUIRED", "URL", "EMAIL", "DATE", "ENUM", "COUNTRY"]));
    expect(record.quality?.verificationState).toBe("SOURCE_CITED_UNVERIFIED");
    expect(pipeline.dataQuality?.metrics.invalidRecordCount).toBe(1);
  });

  it("keeps exact and normalized duplicates as linked rows and records deterministic decisions", () => {
    const entries = [
      { values: { company_name: "Example Co", website: "https://example.com/" }, sourceUrls: ["https://acme.example/source"] },
      { values: { company_name: "  EXAMPLE co ", website: "HTTPS://WWW.EXAMPLE.COM/#home" }, sourceUrls: ["https://acme.example/second"] },
    ];
    const pipeline = new DataQualityService().process(result(entries), basePlan);
    expect(pipeline.records).toHaveLength(2);
    expect(pipeline.records[1]?.quality?.duplicateOfIndex).toBe(0);
    expect(pipeline.dataQuality?.metrics.duplicateCount).toBe(1);
    expect(pipeline.dataQuality?.deduplicationEvents[0]).toMatchObject({ decision: "MERGED", matchType: "URL", canonicalIndex: 0, duplicateIndex: 1 });
    expect(pipeline.records[0]?.sourceUrls).toContain("https://acme.example/second");
  });

  it("records exact duplicate matches without deleting either extracted row", () => {
    const plan = { ...basePlan, deduplicationRules: [{ keys: ["company_name"], strategy: "EXACT", confidenceThreshold: 1, ambiguousMatchAction: "KEEP_SEPARATE", rationale: "Exact company name match." }] } as WorkflowPlan;
    const entries = [
      { values: { company_name: "Exact Name", founder: "Founder" }, sourceUrls: ["https://acme.example/source"] },
      { values: { company_name: "Exact Name", founder: "Founder" }, sourceUrls: ["https://news.example/record"] },
    ];
    const pipeline = new DataQualityService().process(result(entries), plan);
    expect(pipeline.records).toHaveLength(2);
    expect(pipeline.records[1]?.quality?.duplicateOfIndex).toBe(0);
    expect(pipeline.dataQuality?.deduplicationEvents[0]).toMatchObject({ decision: "MERGED", matchType: "EXACT", confidence: 1 });
  });

  it("merges likely entities only with a shared stable identifier and preserves conflicting values", () => {
    const entries = [
      { values: { company_name: "Open AI Inc.", website: "https://openai.example/company", founder: "A. Person", email: "wrong" }, sourceUrls: ["https://acme.example/source"] },
      { values: { company_name: "OpenAI", website: "https://www.openai.example/", founder: "B. Person", email: "good@example.com" }, sourceUrls: ["https://news.example/openai"] },
    ];
    const plan = { ...basePlan, deduplicationRules: [{ keys: ["company_name", "website"], strategy: "FUZZY_REVIEW", confidenceThreshold: 0.8, ambiguousMatchAction: "REVIEW", rationale: "Review likely company matches." }] } as WorkflowPlan;
    const pipeline = new DataQualityService().process(result(entries), plan);
    expect(pipeline.records[1]?.quality?.duplicateOfIndex).toBe(0);
    expect(pipeline.records[0]?.values.founder).toBe("A. Person");
    expect(pipeline.records[0]?.quality?.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldKey: "founder", canonicalValue: "A. Person", alternateValue: "B. Person" }),
      expect.objectContaining({ fieldKey: "email", canonicalValue: "wrong", alternateValue: "good@example.com" }),
    ]));
    expect(pipeline.records[0]?.quality?.verificationState).toBe("CONFLICTED");
    expect(pipeline.dataQuality?.metrics.conflictCount).toBeGreaterThanOrEqual(2);
  });

  it("flags similar names for review rather than merging without a stable identifier", () => {
    const plan = { ...basePlan, deduplicationRules: [{ keys: ["company_name"], strategy: "FUZZY_REVIEW", confidenceThreshold: 0.7, ambiguousMatchAction: "REVIEW", rationale: "Review similar names." }] } as WorkflowPlan;
    const entries = [
      { values: { company_name: "Acme Systems", founder: "One" }, sourceUrls: ["https://acme.example/source"] },
      { values: { company_name: "Acme System", founder: "Two" }, sourceUrls: ["https://news.example/acme"] },
    ];
    const resolved = new EntityResolutionService().resolve(result(entries), plan);
    expect(resolved.result.records).toHaveLength(2);
    expect(resolved.result.records[1]?.quality?.duplicateOfIndex).toBeUndefined();
    expect(resolved.events[0]?.decision).toBe("REVIEW_REQUIRED");
    expect(resolved.reviewRequiredCount).toBe(1);
  });

  it("marks records without tool-verified source evidence as unsupported", () => {
    const pipeline = new DataQualityService().process(result([{ values: { company_name: "No Citation", founder: "N/A" }, sourceUrls: ["https://unobserved.example"] }], []), basePlan);
    expect(pipeline.records[0]?.quality?.verificationState).toBe("UNSUPPORTED");
    expect(pipeline.records[0]?.validationIssues).toEqual(expect.arrayContaining([expect.objectContaining({ ruleCode: "SOURCE_EVIDENCE", severity: "ERROR" })]));
    expect(pipeline.dataQuality?.metrics.unsupportedRecordCount).toBe(1);
  });

  it("validates numeric, integer, boolean, arrays, and objects against the extraction schema", () => {
    const plan = {
      ...basePlan,
      requirement: { requiredFields: [] },
      extractionSchema: { ...basePlan.extractionSchema, required: [], properties: {
        number: { type: "number", description: "Number" },
        integer: { type: "integer", description: "Integer" },
        active: { type: "boolean", description: "Active" },
        tags: { type: "array", description: "Tags" },
        metadata: { type: "object", description: "Metadata" },
      } },
      validationRules: [],
      deduplicationRules: [],
    } as unknown as WorkflowPlan;
    const validation = new ValidationService().validate(result([{ values: { number: "1", integer: 1.2, active: "true", tags: {}, metadata: [] }, sourceUrls: ["https://acme.example/source"] }]), plan);
    expect(validation.result.records[0]?.validationIssues?.map((issue) => issue.ruleCode)).toContain("TYPE");
    expect(validation.summary.invalidRecordCount).toBe(1);
  });
});
