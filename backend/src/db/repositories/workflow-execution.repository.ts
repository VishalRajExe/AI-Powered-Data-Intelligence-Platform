import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../common/errors.js";
import type { AgentResult } from "../../agent/types.js";

export interface WorkflowExecutionStore {
  createRun(input: { workspaceId: string; createdById: string; workflowId: string; planVersion: number }): Promise<{ id: string }>;
  completeRun(runId: string, result: AgentResult): Promise<void>;
}

export class WorkflowExecutionRepository implements WorkflowExecutionStore {
  constructor(private readonly prisma: PrismaClient) {}

  async createRun(input: { workspaceId: string; createdById: string; workflowId: string; planVersion: number }): Promise<{ id: string }> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.createdById } },
      select: { status: true },
    });
    if (membership?.status !== "ACTIVE") throw new AppError("Active workspace membership is required", 403, "WORKSPACE_ACCESS_DENIED");

    const plan = await this.prisma.workflowPlan.findFirst({
      where: { workspaceId: input.workspaceId, workflowId: input.workflowId, version: input.planVersion },
      select: { id: true },
    });
    if (!plan) throw new AppError("The persisted workflow plan was not found", 404, "WORKFLOW_PLAN_NOT_FOUND");
    return this.prisma.workflowRun.create({
      data: {
        workspaceId: input.workspaceId,
        workflowId: input.workflowId,
        workflowPlanId: plan.id,
        status: "RUNNING",
        startedAt: new Date(),
      },
      select: { id: true },
    });
  }

  async completeRun(runId: string, result: AgentResult): Promise<void> {
    const status = result.status === "COMPLETED" ? "COMPLETED" : result.status === "PARTIAL" ? "PARTIAL" : "FAILED";
    const firstError = result.errors[0];
    await this.prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status,
        progress: status === "COMPLETED" ? 100 : 0,
        recordsFound: result.records.length,
        recordsValid: result.records.length,
        sourcesProcessed: result.sources.filter(({ verifiedByTool }) => verifiedByTool).length,
        sourcesFailed: result.errors.length,
        errorCode: firstError?.code ?? null,
        errorMessage: firstError?.message ?? null,
        finishedAt: new Date(),
      },
    });
  }
}
