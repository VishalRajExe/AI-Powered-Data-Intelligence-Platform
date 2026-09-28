import { createHash } from "node:crypto";
import { PrismaClient, SourceStatus, type WorkflowPlan } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DatasetRepository } from "../src/db/repositories/dataset.repository.js";
import { WorkflowExecutionRepository } from "../src/db/repositories/workflow-execution.repository.js";
import { WorkflowSourceRepository } from "../src/db/repositories/workflow-source.repository.js";
import { DataQualityService } from "../src/modules/data-intelligence/DataQualityService.js";
import type { WorkflowPlan as ApplicationWorkflowPlan } from "../src/modules/planner/workflow-plan.schema.js";
import type { AgentResult } from "../src/agent/types.js";

const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === "true" && Boolean(process.env.DATABASE_URL);
const prisma = new PrismaClient();
const repository = new DatasetRepository(prisma);
const workspaceIds: string[] = [];
const userIds: string[] = [];

describe.skipIf(!databaseTestsEnabled)("MySQL domain persistence", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    for (const workspaceId of workspaceIds.splice(0)) {
      await prisma.sourceEvidence.deleteMany({ where: { workspaceId } });
      await prisma.validationIssue.deleteMany({ where: { workspaceId } });
      await prisma.deduplicationEvent.deleteMany({ where: { workspaceId } });
      await prisma.dataQualityReport.deleteMany({ where: { workspaceId } });
      await prisma.workflowStep.deleteMany({ where: { workspaceId } });
      await prisma.source.deleteMany({ where: { workspaceId } });
      await prisma.datasetRow.deleteMany({ where: { workspaceId } });
      await prisma.datasetColumn.deleteMany({ where: { workspaceId } });
      await prisma.exportJob.deleteMany({ where: { workspaceId } });
      await prisma.dataset.deleteMany({ where: { workspaceId } });
      await prisma.workflowRun.deleteMany({ where: { workspaceId } });
      await prisma.workflowPlan.deleteMany({ where: { workspaceId } });
      await prisma.workflow.deleteMany({ where: { workspaceId } });
      await prisma.activityEvent.deleteMany({ where: { workspaceId } });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    }
    for (const userId of userIds.splice(0)) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  });

  it("has the Phase 2 migration applied", async () => {
    const applied = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE (migration_name LIKE '%_phase2_domain_model' OR migration_name LIKE '%_workspace_membership_state' OR migration_name LIKE '%_workflow_planning_state' OR migration_name LIKE '%_source_governance' OR migration_name LIKE '%_phase8_data_quality')
        AND finished_at IS NOT NULL
    `;
    expect(applied).toHaveLength(5);
  });

  it("persists workflows, plans, runs, rows, validation and field-level source provenance", async () => {
    const fixture = await createFixture("primary");
    const edited = await prisma.workflow.update({
      where: { id: fixture.workflow.id },
      data: { name: "Updated development workflow", status: "ACTIVE" },
    });
    expect(edited.name).toBe("Updated development workflow");

    const inserted = await repository.insertRowWithEvidence({
      workspaceId: fixture.workspace.id,
      datasetId: fixture.dataset.id,
      values: { company: "Example Research Fixture", website: "https://example.invalid" },
      confidence: 0.95,
      evidence: [{
        sourceId: fixture.source.id,
        datasetColumnId: fixture.column.id,
        fieldKey: "company",
        snippet: "Development-only provenance fixture.",
        retrievedAt: fixture.source.retrievedAt!,
        confidence: 0.95,
      }],
    });

    await prisma.validationIssue.create({
      data: {
        workspaceId: fixture.workspace.id,
        datasetId: fixture.dataset.id,
        datasetRowId: inserted.id,
        fieldKey: "website",
        ruleCode: "URL_FORMAT",
        severity: "WARNING",
        message: "Fixture URL uses the reserved .invalid domain.",
      },
    });

    const result = await prisma.workflow.findUniqueOrThrow({
      where: { id: fixture.workflow.id },
      include: {
        plans: true,
        runs: {
          include: {
            steps: true,
            dataset: {
              include: {
                columns: true,
                rows: {
                  include: {
                    sourceEvidence: { include: { source: true, column: true } },
                    validationIssues: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]?.requirement).toEqual({ objective: "Create a fixture for persistence tests." });
    expect(result.plans[0]?.completionCriteria).toEqual({ requireSourceEvidence: true });
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]?.dataset?.rows[0]?.sourceEvidence[0]?.source.canonicalUrl).toBe(fixture.source.canonicalUrl);
    expect(result.runs[0]?.dataset?.rows[0]?.sourceEvidence[0]?.column?.key).toBe("company");
    expect(result.runs[0]?.dataset?.rows[0]?.validationIssues).toHaveLength(1);
    expect(result.runs[0]?.dataset?.recordCount).toBe(1);
    expect(result.runs[0]?.dataset?.validCount).toBe(1);

    const page = await prisma.datasetRow.findMany({
      where: { workspaceId: fixture.workspace.id, datasetId: fixture.dataset.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
    });
    expect(page.map(({ id }) => id)).toContain(inserted.id);
  });

  it("creates and finalizes an execution run from a persisted workflow plan", async () => {
    const fixture = await createFixture("execution");
    const requirement = {
      objective: "Collect company names", entityType: "company", quantity: 1,
      geography: { places: [], scope: "unspecified", includeSubregions: null },
      timeRange: { field: null, after: null, before: null, on: null, expression: null }, filters: [], constraints: [],
      fields: [{ key: "company", label: "Company", type: "string", description: null }],
      requiredFields: ["company"], optionalFields: [], sourcePreferences: [], sourceRestrictions: [], deduplicationKeys: ["company"], validationRules: [],
      outputFormat: "json", ambiguities: [], missingInformation: [], warnings: [],
    };
    const retryPolicy = { maxAttempts: 2, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: ["TRANSIENT_NETWORK"] };
    const steps = [
      { id: "search-companies", type: "SEARCH", description: "Find company pages", input: {}, configuration: {}, dependencies: [], retryPolicy, timeoutMs: 30_000, expectedOutput: "Source pages", status: "PENDING" },
      { id: "extract-companies", type: "EXTRACT", description: "Extract company names", input: {}, configuration: {}, dependencies: ["search-companies"], retryPolicy, timeoutMs: 30_000, expectedOutput: "Company rows", status: "PENDING" },
      { id: "save-companies", type: "SAVE", description: "Save dataset", input: {}, configuration: {}, dependencies: ["extract-companies"], retryPolicy, timeoutMs: 30_000, expectedOutput: "Persisted rows", status: "PENDING" },
    ];
    await prisma.workflowPlan.update({ where: { id: fixture.plan.id }, data: {
      objective: "Collect company names", requirement, constraints: [],
      sourcePolicy: { permittedSourceTypes: ["official_website"], allowedDomains: [], preferredDomains: [], blockedDomains: [], respectRobotsTxt: true, respectSiteTerms: true, allowAuthentication: false, allowCaptchaBypass: false, maxRequestsPerDomainPerMinute: 10, policyRationale: "Use public company pages." },
      searchStrategy: { queries: [{ query: "public company example", sourceType: "official_website", rationale: "Find a source." }], desiredSourceCount: 1, maximumSourceCount: 5, selectionRationale: "One source is enough." },
      extractionSchema: { type: "object", properties: { company: { type: "string", description: "Company name" } }, required: ["company"], additionalProperties: false },
      steps, transformations: [], validationRules: [{ fieldKey: "company", rule: "REQUIRED", severity: "ERROR", description: "Company is required." }],
      deduplicationRules: [{ keys: ["company"], strategy: "NORMALIZED", confidenceThreshold: 1, ambiguousMatchAction: "KEEP_SEPARATE", rationale: "Normalize company names." }],
      outputConfiguration: { format: "json", expectedColumns: ["company"], includeSourceEvidence: true },
      completionCriteria: { targetRecordCount: 1, minimumSources: 1, requiredFieldsPresent: ["company"], requireSourceEvidence: true, stopWhenTargetReached: true, allowPartialResults: true, completionDescription: "Collect one sourced company." },
    } });
    const executions = new WorkflowExecutionRepository(prisma);
    const created = await executions.createRun({
      workspaceId: fixture.workspace.id,
      createdById: fixture.user.id,
      workflowId: fixture.workflow.id,
      planVersion: fixture.plan.version,
    });
    const running = await prisma.workflowRun.findUniqueOrThrow({ where: { id: created.id } });
    expect(running.status).toBe("PENDING");
    expect(running.workflowPlanId).toBe(fixture.plan.id);
    expect(await executions.markRunStarted(created.id)).toBe(true);
    expect(await prisma.workflowStep.count({ where: { workflowRunId: created.id } })).toBe(steps.length);

    await executions.completeRun(created.id, {
      status: "COMPLETED",
      data: { records: [{ values: { company: "Execution Fixture" } }] },
      records: [{ values: { company: "Execution Fixture" }, sourceUrls: [fixture.source.canonicalUrl] }],
      sources: [{
        url: fixture.source.canonicalUrl,
        canonicalUrl: fixture.source.canonicalUrl,
        domain: fixture.source.domain,
        title: fixture.source.title ?? "Integration source",
        sourceType: "scrape",
        retrievedAt: fixture.source.retrievedAt!.toISOString(),
        verifiedByTool: true,
      }],
      execution: {
        provider: "mock", model: "mock-agent", startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(), durationMs: 10, inputTokens: 0,
        outputTokens: 0, totalTokens: 0, toolCallCount: 1, toolsUsed: ["scrape"],
      },
      events: [], errors: [],
    });
    const completed = await prisma.workflowRun.findUniqueOrThrow({ where: { id: created.id } });
    expect(completed.status).toBe("COMPLETED");
    expect(completed.progress).toBe(100);
    expect(completed.recordsFound).toBe(1);
    expect(completed.sourcesProcessed).toBe(1);
    expect(completed.finishedAt).toBeInstanceOf(Date);
  });

  it("persists source lifecycle, policy reason, robots result, retries, and deduplicated provenance", async () => {
    const fixture = await createFixture("source-governance");
    const sources = new WorkflowSourceRepository(prisma);
    const input = {
      workspaceId: fixture.workspace.id,
      workflowRunId: fixture.run.id,
      url: fixture.source.url,
      canonicalUrl: fixture.source.canonicalUrl,
      canonicalUrlHash: fixture.source.canonicalUrlHash,
      domain: fixture.source.domain,
      title: "Robots-blocked source",
      metadata: { sourceType: "search", snippet: "Search listing excerpt" },
    };
    const first = await sources.upsertDiscovered(input);
    const duplicate = await sources.upsertDiscovered(input);
    expect(duplicate.id).toBe(first.id);

    await sources.updateLifecycle(fixture.workspace.id, fixture.run.id, fixture.source.canonicalUrlHash, {
      status: "BLOCKED",
      code: "ROBOTS_DISALLOW",
      reason: "robots.txt disallows this path.",
      robotsStatus: "DISALLOWED",
      robotsCheckedAt: new Date(),
      attemptCount: 0,
    });
    const persisted = await prisma.source.findUniqueOrThrow({ where: { id: first.id } });
    expect(persisted).toMatchObject({
      status: "BLOCKED", errorCode: "ROBOTS_DISALLOW", policyReason: "robots.txt disallows this path.",
      robotsStatus: "DISALLOWED", attemptCount: 0,
    });
    expect(persisted.sourceMetadata).toEqual({ sourceType: "search", snippet: "Search listing excerpt" });
    expect(persisted.robotsCheckedAt).toBeInstanceOf(Date);
  });

  it("allows collected sources to back dataset evidence", async () => {
    const fixture = await createFixture("collected-evidence");
    await prisma.source.update({ where: { id: fixture.source.id }, data: { status: SourceStatus.COLLECTED } });
    const row = await repository.insertRowWithEvidence({
      workspaceId: fixture.workspace.id,
      datasetId: fixture.dataset.id,
      values: { company: "Collected Source Fixture" },
      evidence: [{ sourceId: fixture.source.id, fieldKey: "company", retrievedAt: fixture.source.retrievedAt! }],
    });
    expect(row.sourceEvidence[0]?.source.status).toBe(SourceStatus.COLLECTED);
  });

  it("persists normalized values, raw values, duplicate links, conflicts, provenance, and quality metrics", async () => {
    const fixture = await createFixture("quality-pipeline");
    await prisma.source.update({ where: { id: fixture.source.id }, data: { datasetId: null } });
    await prisma.dataset.delete({ where: { id: fixture.dataset.id } });
    const plan = {
      version: 1, objective: "Collect companies", requirement: { requiredFields: ["company_name"] },
      constraints: [], sourcePolicy: { preferredDomains: [] },
      searchStrategy: { queries: [], maximumSourceCount: 10 }, steps: [],
      extractionSchema: {
        type: "object", required: ["company_name"], additionalProperties: false,
        properties: { company_name: { type: "string", description: "Company name" }, founder: { type: "string", description: "Founder" } },
      },
      transformations: [], validationRules: [],
      deduplicationRules: [{ keys: ["company_name"], strategy: "NORMALIZED", confidenceThreshold: 0.95, ambiguousMatchAction: "KEEP_SEPARATE", rationale: "Normalize company names." }],
      completionCriteria: {}, outputConfiguration: {},
    } as unknown as ApplicationWorkflowPlan;
    const sourceUrl = fixture.source.canonicalUrl;
    const now = new Date().toISOString();
    const rawResult: AgentResult = {
      status: "COMPLETED", data: null,
      records: [
        { values: { company_name: "Example Acme", founder: "Founder A" }, sourceUrls: [sourceUrl] },
        { values: { company_name: " example   acme ", founder: "Founder B" }, sourceUrls: [sourceUrl] },
      ],
      sources: [{ url: sourceUrl, canonicalUrl: sourceUrl, domain: fixture.source.domain, sourceType: "scrape", retrievedAt: fixture.source.retrievedAt!.toISOString(), verifiedByTool: true }],
      execution: { provider: "mock", model: "mock", startedAt: now, finishedAt: now, durationMs: 1, inputTokens: 0, outputTokens: 0, totalTokens: 0, toolCallCount: 0, toolsUsed: [] },
      events: [], errors: [],
    };
    const processed = new DataQualityService().process(rawResult, plan);
    const executions = new WorkflowExecutionRepository(prisma);
    const saved = await executions.persistDataset({
      id: fixture.run.id, workspaceId: fixture.workspace.id, workflowId: fixture.workflow.id, createdById: fixture.user.id,
      requirement: "Collect companies", plan, cancelRequestedAt: null,
    }, processed);
    const dataset = await prisma.dataset.findUniqueOrThrow({
      where: { id: saved.datasetId },
      include: {
        rows: { include: { sourceEvidence: true } },
        dataQualityReport: true,
        deduplicationEvents: true,
      },
    });
    const canonical = dataset.rows.find((row) => row.duplicateOfId === null);
    const duplicate = dataset.rows.find((row) => row.duplicateOfId !== null);
    expect(dataset.rows).toHaveLength(2);
    expect(duplicate?.duplicateOfId).toBe(canonical?.id);
    expect(canonical?.rawValues).toEqual({ company_name: "Example Acme", founder: "Founder A" });
    expect(canonical?.qualityMetadata).toMatchObject({ verificationState: "CONFLICTED" });
    expect(dataset.deduplicationEvents).toHaveLength(1);
    expect(dataset.deduplicationEvents[0]?.decision).toBe("MERGED");
    expect(dataset.dataQualityReport).toHaveLength(1);
    expect(dataset.dataQualityReport[0]?.metrics).toMatchObject({ duplicateCount: 1, conflictCount: 1, rawRecordCount: 2 });
    expect(dataset.rows.every((row) => row.sourceEvidence.length > 0)).toBe(true);
  });

  it("enforces version and column uniqueness plus workspace boundaries", async () => {
    const fixture = await createFixture("constraint-a");
    const other = await createFixture("constraint-b");

    await expect(prisma.workflowPlan.create({
      data: {
        workspaceId: fixture.workspace.id,
        workflowId: fixture.workflow.id,
        version: fixture.plan.version,
        objective: "duplicate version",
        requirement: { objective: "duplicate version" },
        sourcePolicy: {},
        searchStrategy: {},
        extractionSchema: {},
        steps: [],
        completionCriteria: {},
        planHash: "f".repeat(64),
      },
    })).rejects.toMatchObject({ code: "P2002" });

    await expect(prisma.datasetColumn.create({
      data: {
        workspaceId: fixture.workspace.id,
        datasetId: fixture.dataset.id,
        key: fixture.column.key,
        label: "Duplicate company",
        type: "STRING",
        position: 1,
      },
    })).rejects.toMatchObject({ code: "P2002" });

    const row = await repository.insertRowWithEvidence({
      workspaceId: fixture.workspace.id,
      datasetId: fixture.dataset.id,
      values: { company: "Boundary Fixture" },
      evidence: [{
        sourceId: fixture.source.id,
        fieldKey: "company",
        retrievedAt: fixture.source.retrievedAt!,
      }],
    });
    await expect(prisma.sourceEvidence.create({
      data: {
        workspaceId: fixture.workspace.id,
        datasetId: fixture.dataset.id,
        datasetRowId: row.id,
        sourceId: other.source.id,
        retrievedAt: new Date(),
      },
    })).rejects.toMatchObject({ code: "P2003" });

    await expect(repository.insertRowWithEvidence({
      workspaceId: fixture.workspace.id,
      datasetId: fixture.dataset.id,
      values: { company: "No source" },
      evidence: [],
    })).rejects.toThrow(/at least one source evidence/);
  });
});

async function createFixture(label: string) {
  const suffix = `${label}-${crypto.randomUUID()}`;
  const user = await prisma.user.create({
    data: { email: `${suffix}@example.invalid`, name: "Integration Test User" },
  });
  userIds.push(user.id);

  const workspace = await prisma.workspace.create({
    data: {
      name: `Integration ${label}`,
      slug: suffix,
      createdById: user.id,
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  workspaceIds.push(workspace.id);

  const workflow = await prisma.workflow.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      name: `Workflow ${label}`,
      requirement: "Collect a development-only test fixture.",
      planningStatus: "PLANNED",
    },
  });
  const plan: WorkflowPlan = await prisma.workflowPlan.create({
    data: {
      workspaceId: workspace.id,
      workflowId: workflow.id,
      version: 1,
      objective: "Create a fixture for persistence tests.",
      requirement: { objective: "Create a fixture for persistence tests." },
      constraints: { permittedDomain: "example.invalid" },
      sourcePolicy: { respectRobots: true },
      searchStrategy: { queries: ["integration fixture"] },
      extractionSchema: { type: "object", required: ["company"] },
      steps: [{ type: "SEARCH" }, { type: "EXTRACT" }],
      completionCriteria: { requireSourceEvidence: true },
      planHash: "a".repeat(64),
    },
  });
  const run = await prisma.workflowRun.create({
    data: { workspaceId: workspace.id, workflowId: workflow.id, workflowPlanId: plan.id },
  });
  const dataset = await prisma.dataset.create({
    data: {
      workspaceId: workspace.id,
      workflowRunId: run.id,
      createdById: user.id,
      name: `Dataset ${label}`,
    },
  });
  const column = await prisma.datasetColumn.create({
    data: {
      workspaceId: workspace.id,
      datasetId: dataset.id,
      key: "company",
      label: "Company",
      type: "STRING",
      position: 0,
      required: true,
    },
  });
  const canonicalUrl = `https://example.invalid/${encodeURIComponent(suffix)}`;
  const source = await prisma.source.create({
    data: {
      workspaceId: workspace.id,
      workflowRunId: run.id,
      datasetId: dataset.id,
      url: canonicalUrl,
      canonicalUrl,
      canonicalUrlHash: hashText(canonicalUrl),
      domain: "example.invalid",
      title: "Development-only fixture source",
      status: SourceStatus.FETCHED,
      retrievedAt: new Date(),
    },
  });

  return { user, workspace, workflow, plan, run, dataset, column, source };
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
