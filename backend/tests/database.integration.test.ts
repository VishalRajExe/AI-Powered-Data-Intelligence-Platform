import { createHash } from "node:crypto";
import { PrismaClient, SourceStatus, type WorkflowPlan } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DatasetRepository } from "../src/db/repositories/dataset.repository.js";

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
      WHERE (migration_name LIKE '%_phase2_domain_model' OR migration_name LIKE '%_workspace_membership_state')
        AND finished_at IS NOT NULL
    `;
    expect(applied).toHaveLength(2);
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

  it("enforces version and column uniqueness plus workspace boundaries", async () => {
    const fixture = await createFixture("constraint-a");
    const other = await createFixture("constraint-b");

    await expect(prisma.workflowPlan.create({
      data: {
        workspaceId: fixture.workspace.id,
        workflowId: fixture.workflow.id,
        version: fixture.plan.version,
        objective: "duplicate version",
        sourcePolicy: {},
        searchStrategy: {},
        extractionSchema: {},
        steps: [],
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
    },
  });
  const plan: WorkflowPlan = await prisma.workflowPlan.create({
    data: {
      workspaceId: workspace.id,
      workflowId: workflow.id,
      version: 1,
      objective: "Create a fixture for persistence tests.",
      constraints: { permittedDomain: "example.invalid" },
      sourcePolicy: { respectRobots: true },
      searchStrategy: { queries: ["integration fixture"] },
      extractionSchema: { type: "object", required: ["company"] },
      steps: [{ type: "SEARCH" }, { type: "EXTRACT" }],
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
