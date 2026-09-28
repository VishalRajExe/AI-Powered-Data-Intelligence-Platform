import type { Prisma, PrismaClient, WorkflowStatus } from "@prisma/client";
import { AppError } from "../../common/errors.js";
import type {
  WorkflowListItem,
  WorkflowDetail,
  WorkflowRunView,
  WorkflowLastRunSummary,
  WorkflowDatasetSummary,
  RunActivityEvent,
} from "../../modules/monitoring/monitoring.types.js";

export interface ListWorkflowsQuery {
  page?: number | undefined;
  limit?: number | undefined;
  search?: string | undefined;
  status?: string | undefined;
}

export class WorkflowHistoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Asserts user has active membership in the workspace.
   */
  async assertAccess(workspaceId: string, userId: string): Promise<void> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { status: true },
    });
    if (membership?.status !== "ACTIVE") {
      throw new AppError("Active workspace membership is required", 403, "WORKSPACE_ACCESS_DENIED");
    }
  }

  /**
   * Lists workflows in a workspace with their last run summary, latest dataset, and run counts.
   */
  async listWorkflows(
    workspaceId: string,
    userId: string,
    query: ListWorkflowsQuery = {},
  ): Promise<{
    items: WorkflowListItem[];
    total: number;
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    await this.assertAccess(workspaceId, userId);

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Prisma.WorkflowWhereInput = {
      workspaceId,
      ...(query.status && isValidWorkflowStatus(query.status)
        ? { status: query.status as WorkflowStatus }
        : {}),
      ...(query.search?.trim()
        ? {
            OR: [
              { name: { contains: query.search.trim() } },
              { requirement: { contains: query.search.trim() } },
            ],
          }
        : {}),
    };

    const [total, workflows] = await Promise.all([
      this.prisma.workflow.count({ where }),
      this.prisma.workflow.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: "desc" },
        include: {
          runs: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              dataset: {
                select: {
                  id: true,
                  name: true,
                  recordCount: true,
                  validCount: true,
                  duplicateCount: true,
                  sourceCount: true,
                  status: true,
                  createdAt: true,
                },
              },
            },
          },
          _count: {
            select: { runs: true },
          },
        },
      }),
    ]);

    const items: WorkflowListItem[] = workflows.map((wf) => {
      const lastRunRecord = wf.runs[0] ?? null;
      let lastRun: WorkflowLastRunSummary | null = null;
      let dataset: WorkflowDatasetSummary | null = null;

      if (lastRunRecord) {
        const duration = calculateDuration(lastRunRecord.startedAt, lastRunRecord.finishedAt);
        lastRun = {
          id: lastRunRecord.id,
          status: lastRunRecord.status,
          started: lastRunRecord.startedAt ? lastRunRecord.startedAt.toISOString() : null,
          completed: lastRunRecord.finishedAt ? lastRunRecord.finishedAt.toISOString() : null,
          duration,
          durationMs: duration,
          recordsFound: lastRunRecord.recordsFound,
          recordsAccepted: lastRunRecord.recordsValid,
          duplicates: lastRunRecord.duplicateCount,
          failures: lastRunRecord.sourcesFailed,
          sourceCount: lastRunRecord.sourcesProcessed,
        };

        if (lastRunRecord.dataset) {
          dataset = {
            id: lastRunRecord.dataset.id,
            name: lastRunRecord.dataset.name,
            recordCount: lastRunRecord.dataset.recordCount,
            validCount: lastRunRecord.dataset.validCount,
            duplicateCount: lastRunRecord.dataset.duplicateCount,
            sourceCount: lastRunRecord.dataset.sourceCount,
            status: lastRunRecord.dataset.status,
            createdAt: lastRunRecord.dataset.createdAt.toISOString(),
          };
        }
      }

      return {
        id: wf.id,
        workspaceId: wf.workspaceId,
        name: wf.name,
        originalPrompt: wf.requirement,
        requirement: wf.requirement,
        createdTime: wf.createdAt.toISOString(),
        createdAt: wf.createdAt.toISOString(),
        updatedAt: wf.updatedAt.toISOString(),
        status: wf.status,
        planningStatus: wf.planningStatus,
        numberOfRuns: wf._count.runs,
        runsCount: wf._count.runs,
        lastRun,
        dataset,
      };
    });

    return {
      items,
      total,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Retrieves single workflow detail with recent runs and latest plan.
   */
  async getWorkflow(workspaceId: string, workflowId: string, userId: string): Promise<WorkflowDetail> {
    await this.assertAccess(workspaceId, userId);

    const wf = await this.prisma.workflow.findFirst({
      where: { id: workflowId, workspaceId },
      include: {
        plans: {
          orderBy: { version: "desc" },
          take: 1,
          select: {
            id: true,
            version: true,
            objective: true,
            steps: true,
            planHash: true,
            createdAt: true,
          },
        },
        runs: {
          orderBy: { createdAt: "desc" },
          take: 10,
          include: {
            dataset: {
              select: {
                id: true,
                name: true,
                recordCount: true,
                validCount: true,
                duplicateCount: true,
                sourceCount: true,
                status: true,
                createdAt: true,
              },
            },
          },
        },
        _count: {
          select: { runs: true },
        },
      },
    });

    if (!wf) throw new AppError("Workflow was not found", 404, "WORKFLOW_NOT_FOUND");

    const recentRuns: WorkflowRunView[] = wf.runs.map((r) => formatRunView(r));
    const lastRunRecord = wf.runs[0] ?? null;

    let lastRun: WorkflowLastRunSummary | null = null;
    let dataset: WorkflowDatasetSummary | null = null;

    if (lastRunRecord) {
      const duration = calculateDuration(lastRunRecord.startedAt, lastRunRecord.finishedAt);
      lastRun = {
        id: lastRunRecord.id,
        status: lastRunRecord.status,
        started: lastRunRecord.startedAt ? lastRunRecord.startedAt.toISOString() : null,
        completed: lastRunRecord.finishedAt ? lastRunRecord.finishedAt.toISOString() : null,
        duration,
        durationMs: duration,
        recordsFound: lastRunRecord.recordsFound,
        recordsAccepted: lastRunRecord.recordsValid,
        duplicates: lastRunRecord.duplicateCount,
        failures: lastRunRecord.sourcesFailed,
        sourceCount: lastRunRecord.sourcesProcessed,
      };

      if (lastRunRecord.dataset) {
        dataset = {
          id: lastRunRecord.dataset.id,
          name: lastRunRecord.dataset.name,
          recordCount: lastRunRecord.dataset.recordCount,
          validCount: lastRunRecord.dataset.validCount,
          duplicateCount: lastRunRecord.dataset.duplicateCount,
          sourceCount: lastRunRecord.dataset.sourceCount,
          status: lastRunRecord.dataset.status,
          createdAt: lastRunRecord.dataset.createdAt.toISOString(),
        };
      }
    }

    const latestPlanRecord = wf.plans[0] ?? null;
    const latestPlan = latestPlanRecord
      ? {
          id: latestPlanRecord.id,
          version: latestPlanRecord.version,
          objective: latestPlanRecord.objective,
          stepCount: Array.isArray(latestPlanRecord.steps) ? latestPlanRecord.steps.length : 0,
          planHash: latestPlanRecord.planHash,
          createdAt: latestPlanRecord.createdAt.toISOString(),
        }
      : null;

    return {
      id: wf.id,
      workspaceId: wf.workspaceId,
      createdById: wf.createdById,
      name: wf.name,
      originalPrompt: wf.requirement,
      requirement: wf.requirement,
      createdTime: wf.createdAt.toISOString(),
      createdAt: wf.createdAt.toISOString(),
      updatedAt: wf.updatedAt.toISOString(),
      status: wf.status,
      planningStatus: wf.planningStatus,
      planningErrorCode: wf.planningErrorCode,
      planningErrorMessage: wf.planningErrorMessage,
      numberOfRuns: wf._count.runs,
      runsCount: wf._count.runs,
      lastRun,
      dataset,
      latestPlan,
      recentRuns,
    };
  }

  /**
   * Lists runs for a specific workflow.
   */
  async getWorkflowRuns(
    workspaceId: string,
    workflowId: string,
    userId: string,
    query: { page?: number; limit?: number } = {},
  ): Promise<{
    items: WorkflowRunView[];
    total: number;
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    await this.assertAccess(workspaceId, userId);

    const wf = await this.prisma.workflow.findFirst({
      where: { id: workflowId, workspaceId },
      select: { id: true },
    });
    if (!wf) throw new AppError("Workflow was not found", 404, "WORKFLOW_NOT_FOUND");

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const [total, runs] = await Promise.all([
      this.prisma.workflowRun.count({ where: { workspaceId, workflowId } }),
      this.prisma.workflowRun.findMany({
        where: { workspaceId, workflowId },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          dataset: {
            select: {
              id: true,
              name: true,
              recordCount: true,
              validCount: true,
              duplicateCount: true,
              sourceCount: true,
              status: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    return {
      items: runs.map((r) => formatRunView(r)),
      total,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Retrieves single workflow run view with duration, counts, failures, and steps.
   */
  async getRun(workspaceId: string, runId: string, userId: string): Promise<WorkflowRunView> {
    await this.assertAccess(workspaceId, userId);

    const run = await this.prisma.workflowRun.findFirst({
      where: { id: runId, workspaceId },
      include: {
        workflow: { select: { name: true } },
        dataset: {
          select: {
            id: true,
            name: true,
            recordCount: true,
            validCount: true,
            duplicateCount: true,
            sourceCount: true,
            status: true,
            createdAt: true,
          },
        },
        steps: { orderBy: { sequence: "asc" } },
      },
    });

    if (!run) throw new AppError("Workflow run was not found", 404, "WORKFLOW_RUN_NOT_FOUND");

    return formatRunView(run);
  }

  /**
   * Retrieves durable activity events for a workflow run.
   */
  async getRunActivity(workspaceId: string, runId: string, userId: string): Promise<RunActivityEvent[]> {
    await this.assertAccess(workspaceId, userId);

    const run = await this.prisma.workflowRun.findFirst({
      where: { id: runId, workspaceId },
      select: { id: true },
    });
    if (!run) throw new AppError("Workflow run was not found", 404, "WORKFLOW_RUN_NOT_FOUND");

    const events = await this.prisma.activityEvent.findMany({
      where: {
        workspaceId,
        entityId: runId,
      },
      orderBy: { createdAt: "asc" },
      take: 500,
    });

    return events.map((ev) => ({
      id: ev.id,
      workspaceId: ev.workspaceId,
      actorId: ev.actorId,
      action: ev.action,
      entityType: ev.entityType,
      entityId: ev.entityId,
      details: (ev.details as Record<string, unknown> | null) ?? null,
      createdAt: ev.createdAt.toISOString(),
    }));
  }
}

function calculateDuration(startedAt?: Date | null, finishedAt?: Date | null): number {
  if (!startedAt) return 0;
  if (finishedAt) return Math.max(0, finishedAt.getTime() - startedAt.getTime());
  return Math.max(0, Date.now() - startedAt.getTime());
}

function isValidWorkflowStatus(status: string): boolean {
  return ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"].includes(status);
}

function formatRunView(run: {
  id: string;
  workspaceId: string;
  workflowId: string;
  workflowPlanId: string;
  status: string;
  progress: number;
  recordsFound: number;
  recordsValid: number;
  duplicateCount: number;
  sourcesProcessed: number;
  sourcesFailed: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  cancelRequestedAt?: Date | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  workflow?: { name: string } | null;
  dataset?: {
    id: string;
    name: string;
    recordCount: number;
    validCount?: number;
    duplicateCount?: number;
    sourceCount?: number;
    status: string;
    createdAt: Date;
  } | null;
  steps?: Array<{
    id: string;
    sequence: number;
    type: string;
    status: string;
    attempt: number;
    retryCount: number;
    durationMs?: number | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
    outputSummary?: unknown;
    errorCode?: string | null;
    errorMessage?: string | null;
  }>;
}): WorkflowRunView {
  const duration = calculateDuration(run.startedAt, run.finishedAt);
  const started = run.startedAt ? run.startedAt.toISOString() : null;
  const completed = run.finishedAt ? run.finishedAt.toISOString() : null;

  return {
    id: run.id,
    workspaceId: run.workspaceId,
    workflowId: run.workflowId,
    workflowName: run.workflow?.name,
    workflowPlanId: run.workflowPlanId,
    status: run.status,
    progress: run.progress,
    started,
    startedAt: started,
    completed,
    finishedAt: completed,
    duration,
    durationMs: duration,
    recordsFound: run.recordsFound,
    recordsAccepted: run.recordsValid,
    recordsValid: run.recordsValid,
    duplicates: run.duplicateCount,
    duplicateCount: run.duplicateCount,
    failures: run.sourcesFailed,
    sourcesFailed: run.sourcesFailed,
    sourceCount: run.sourcesProcessed,
    sourcesProcessed: run.sourcesProcessed,
    errorCode: run.errorCode ?? null,
    errorMessage: run.errorMessage ?? null,
    cancelRequestedAt: run.cancelRequestedAt ? run.cancelRequestedAt.toISOString() : null,
    dataset: run.dataset
      ? {
          id: run.dataset.id,
          name: run.dataset.name,
          recordCount: run.dataset.recordCount,
          validCount: run.dataset.validCount ?? undefined,
          duplicateCount: run.dataset.duplicateCount ?? undefined,
          sourceCount: run.dataset.sourceCount ?? undefined,
          status: run.dataset.status,
          createdAt: run.dataset.createdAt.toISOString(),
        }
      : null,
    steps: run.steps?.map((s) => ({
      id: s.id,
      sequence: s.sequence,
      type: s.type,
      status: s.status,
      attempt: s.attempt,
      retryCount: s.retryCount,
      durationMs: s.durationMs ?? null,
      startedAt: s.startedAt ? s.startedAt.toISOString() : null,
      finishedAt: s.finishedAt ? s.finishedAt.toISOString() : null,
      outputSummary: s.outputSummary,
      errorCode: s.errorCode ?? null,
      errorMessage: s.errorMessage ?? null,
    })),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}
