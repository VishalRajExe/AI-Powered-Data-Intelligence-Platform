import pino from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadEnvConfig } from "../src/config/env.js";
import { createApp } from "../src/app.js";
import { RequirementParserService } from "../src/modules/requirements/parser.service.js";
import { DataRequirementSchema, type RequirementModelOutput } from "../src/modules/requirements/requirement.schema.js";
import { REQUIREMENT_SYSTEM_PROMPT } from "../src/modules/requirements/prompt.js";
import { AiSdkRequirementProvider } from "../src/modules/requirements/provider.js";

interface RequirementFixture {
  kind: string;
  prompt: string;
  entityType: string;
  fields: Array<{ key: string; label: string; type: RequirementModelOutput["fields"][number]["type"] }>;
  quantity: number | null;
  places?: string[];
  timeRange?: RequirementModelOutput["timeRange"];
  filters?: RequirementModelOutput["filters"];
  optionalFields?: string[];
  sourcePreferences?: string[];
  outputFormat?: RequirementModelOutput["outputFormat"];
}

const fixtures: RequirementFixture[] = [
  {
    kind: "jobs",
    prompt: "Find 20 remote engineering jobs in India posted after 2025-01-01 with title, employer, location, salary and application URL.",
    entityType: "job posting",
    quantity: 20,
    places: ["India"],
    timeRange: { field: "posted_at", after: "2025-01-01", before: null, on: null, expression: null },
    fields: [
      { key: "title", label: "Job title", type: "string" },
      { key: "employer", label: "Employer", type: "string" },
      { key: "location", label: "Location", type: "string" },
      { key: "salary", label: "Salary", type: "currency" },
      { key: "application_url", label: "Application URL", type: "url" },
    ],
    filters: [{ field: "remote", operator: "eq", value: true }],
  },
  {
    kind: "sales leads",
    prompt: "Find 50 SaaS sales prospects in Singapore that are hiring sales leaders. Include company, decision maker, work email if available, and website.",
    entityType: "sales prospect",
    quantity: 50,
    places: ["Singapore"],
    fields: [
      { key: "company", label: "Company", type: "string" },
      { key: "decision_maker", label: "Decision maker", type: "string" },
      { key: "work_email", label: "Work email", type: "email" },
      { key: "website", label: "Website", type: "url" },
    ],
    optionalFields: ["work_email"],
    filters: [{ field: "hiring_sales_leaders", operator: "eq", value: true }],
  },
  {
    kind: "sponsor opportunities",
    prompt: "List climate technology events with open sponsor opportunities next year, including event name, organizer, sponsorship deadline and opportunity URL. Prefer official event sites.",
    entityType: "sponsorship opportunity",
    quantity: null,
    sourcePreferences: ["official event sites"],
    timeRange: { field: "event_date", after: null, before: null, on: null, expression: "next year" },
    fields: [
      { key: "event_name", label: "Event name", type: "string" },
      { key: "organizer", label: "Organizer", type: "string" },
      { key: "sponsorship_deadline", label: "Sponsorship deadline", type: "date" },
      { key: "opportunity_url", label: "Opportunity URL", type: "url" },
    ],
  },
  {
    kind: "companies",
    prompt: "Find 100 Indian AI startups founded after 2020 with company name, founder, website, funding and LinkedIn.",
    entityType: "AI startup",
    quantity: 100,
    places: ["India"],
    timeRange: { field: "founded_at", after: "2020", before: null, on: null, expression: null },
    fields: [
      { key: "company_name", label: "Company name", type: "string" },
      { key: "founder", label: "Founder", type: "string" },
      { key: "website", label: "Website", type: "url" },
      { key: "funding", label: "Funding", type: "currency" },
      { key: "linkedin", label: "LinkedIn URL", type: "url" },
    ],
    outputFormat: "csv",
  },
  {
    kind: "products",
    prompt: "Compare current prices for noise-cancelling headphones sold in Canada. Return brand, model, price, currency and product page as JSON.",
    entityType: "product listing",
    quantity: null,
    places: ["Canada"],
    fields: [
      { key: "brand", label: "Brand", type: "string" },
      { key: "model", label: "Model", type: "string" },
      { key: "price", label: "Price", type: "currency" },
      { key: "currency", label: "Currency", type: "string" },
      { key: "product_url", label: "Product page", type: "url" },
    ],
    outputFormat: "json",
  },
  {
    kind: "market information",
    prompt: "Summarize the publicly listed subscription tiers for Acme and Northstar, including plan name, monthly price, key features and the date checked.",
    entityType: "subscription market information",
    quantity: null,
    fields: [
      { key: "company", label: "Company", type: "string" },
      { key: "plan_name", label: "Plan name", type: "string" },
      { key: "monthly_price", label: "Monthly price", type: "currency" },
      { key: "key_features", label: "Key features", type: "json" },
      { key: "date_checked", label: "Date checked", type: "date" },
    ],
  },
  {
    kind: "mixed-field dataset",
    prompt: "Collect community technology events with name, date, venue, organizer contact, attendance capacity, ticket price and registration link.",
    entityType: "community technology event",
    quantity: null,
    fields: [
      { key: "event_name", label: "Event name", type: "string" },
      { key: "event_date", label: "Event date", type: "date" },
      { key: "venue", label: "Venue", type: "string" },
      { key: "organizer_contact", label: "Organizer contact", type: "string" },
      { key: "attendance_capacity", label: "Attendance capacity", type: "number" },
      { key: "ticket_price", label: "Ticket price", type: "currency" },
      { key: "registration_url", label: "Registration link", type: "url" },
    ],
  },
];

function makeOutput(fixture: RequirementFixture): RequirementModelOutput {
  const fields = fixture.fields.map((field) => ({ ...field, description: null }));
  const optionalFields = fixture.optionalFields ?? [];
  return {
    objective: `Collect ${fixture.entityType} matching the user's stated conditions.`,
    entityType: fixture.entityType,
    quantity: fixture.quantity,
    geography: {
      places: fixture.places ?? [],
      scope: fixture.places?.length ? "country" : "unspecified",
      includeSubregions: null,
    },
    timeRange: fixture.timeRange ?? { field: null, after: null, before: null, on: null, expression: null },
    filters: fixture.filters ?? [],
    constraints: [],
    fields,
    requiredFields: fields.map(({ key }) => key).filter((key) => !optionalFields.includes(key)),
    optionalFields,
    sourcePreferences: fixture.sourcePreferences ?? [],
    sourceRestrictions: [],
    deduplicationKeys: fields.length ? [fields[0]!.key] : [],
    validationRules: [],
    outputFormat: fixture.outputFormat ?? "unspecified",
    ambiguities: [],
    missingInformation: [],
    warnings: [],
  };
}

function makeParser(output: unknown) {
  return new RequirementParserService({ generateRequirement: async () => output }, pino({ enabled: false }));
}

const config = loadEnvConfig({
  APP_ENV: "test",
  MYSQL_HOST: "localhost",
  MYSQL_PORT: "3306",
  MYSQL_USER: "aidp",
  MYSQL_PASSWORD: "",
  MYSQL_DATABASE: "aidp_test",
});

describe("natural-language requirement parsing", () => {
  it.each(fixtures)("structures $kind requests without collecting data", async (fixture) => {
    const result = await makeParser(makeOutput(fixture)).parse(fixture.prompt);
    expect(result.validationStatus).toBe("valid");
    expect(result.parsedRequirement.entityType).toBe(fixture.entityType);
    expect(result.parsedRequirement.fields.map(({ key }) => key)).toEqual(fixture.fields.map(({ key }) => key));
    expect(result.parsedRequirement.quantity).toBe(fixture.quantity);
  });

  it("preserves missing meaning as ambiguity and requests clarification", async () => {
    const ambiguous: RequirementModelOutput = {
      ...makeOutput({ ...fixtures[0]!, entityType: "unknown", fields: [], quantity: null }),
      objective: null,
      entityType: null,
      fields: [],
      requiredFields: [],
      optionalFields: [],
      deduplicationKeys: [],
      ambiguities: [{ topic: "target", question: "What kind of information should I collect?", context: "The prompt does not identify a subject." }],
      missingInformation: ["Target entity or information type"],
    };

    const result = await makeParser(ambiguous).parse("Find useful things for me");
    expect(result.validationStatus).toBe("needs_clarification");
    expect(result.parsedRequirement.entityType).toBeNull();
    expect(result.parsedRequirement.ambiguities[0]?.question).toContain("What kind");
    expect(result.missingInformation).toContain("At least one requested field or attribute");
  });

  it("rejects invalid provider output rather than fabricating a requirement", async () => {
    const invalid = { ...makeOutput(fixtures[0]!), requiredFields: ["invented_field"] };
    await expect(makeParser(invalid).parse(fixtures[0]!.prompt)).rejects.toMatchObject({
      statusCode: 502,
      code: "INVALID_REQUIREMENT_OUTPUT",
    });
  });

  it("maps provider failure to a retryable error without exposing provider details", async () => {
    const parser = new RequirementParserService({
      generateRequirement: async () => { throw new Error("private provider response detail"); },
    }, pino({ enabled: false }));
    await expect(parser.parse(fixtures[0]!.prompt)).rejects.toMatchObject({
      statusCode: 503,
      code: "REQUIREMENT_PROVIDER_UNAVAILABLE",
      message: "Requirement analysis failed. Please retry.",
    });
  });

  it("does not call a provider when model credentials are missing", async () => {
    const provider = new AiSdkRequirementProvider(config, pino({ enabled: false }));
    await expect(provider.generateRequirement("Find recent job listings with title and company"))
      .rejects.toMatchObject({ statusCode: 503, code: "LLM_CONFIGURATION_ERROR" });
  });

  it("exposes a validated versioned endpoint and rejects invalid request bodies", async () => {
    const parser = makeParser(makeOutput(fixtures[0]!));
    const app = createApp({
      config,
      logger: pino({ enabled: false }),
      requirementParser: parser,
      workflowPlanner: { plan: async () => { throw new Error("Workflow planner not used in this test"); } },
      readiness: { mysql: async () => 1, redis: async () => "PONG" },
    });

    const invalid = await request(app).post("/api/v1/requirements/parse").send({ prompt: "   " });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");

    const valid = await request(app).post("/api/v1/requirements/parse").send({ prompt: fixtures[0]!.prompt });
    expect(valid.status).toBe(200);
    expect(valid.body.validationStatus).toBe("valid");
    expect(valid.body.parsedRequirement.entityType).toBe("job posting");
    expect(valid.body).toHaveProperty("warnings");
    expect(valid.body).toHaveProperty("missingInformation");
  });

  it("rejects inconsistent field references and keeps web collection out of the parser prompt", () => {
    const invalid = { ...makeOutput(fixtures[0]!), optionalFields: ["not_a_field"] };
    expect(DataRequirementSchema.safeParse(invalid).success).toBe(false);
    expect(REQUIREMENT_SYSTEM_PROMPT).toMatch(/do not search, browse, scrape, call tools/);
    expect(REQUIREMENT_SYSTEM_PROMPT).toMatch(/untrusted data/);
  });
});
