import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../common/errors.js";
import type { DataRequirement } from "../../modules/requirements/requirement.schema.js";
import type { WorkflowPlan } from "../../modules/planner/workflow-plan.schema.js";
import { ActivityActions } from "../../modules/monitoring/monitoring.types.js";

export interface CreatedWorkflow { id: string; }

export interface WorkflowPlannerStore {
  createPlanningWorkflow(input: { workspaceId: string; createdById: string; name: string; requirement: string }): Promise<CreatedWorkflow>;
  savePlan(workflowId: string, workspaceId: string, requirement: DataRequirement, plan: WorkflowPlan): Promise<void>;
  markPlanningFailed(workflowId: string, code: string, message: string): Promise<void>;
}

export class WorkflowPlannerRepository implements WorkflowPlannerStore {
  constructor(private readonly prisma: PrismaClient) {}

  async createPlanningWorkflow(input: { workspaceId: string; createdById: string; name: string; requirement: string }): Promise<CreatedWorkflow> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.createdById } },
      select: { status: true },
    });
    if (membership?.status !== "ACTIVE") throw new AppError("Active workspace membership is required", 403, "WORKSPACE_ACCESS_DENIED");
    const workflow = await this.prisma.workflow.create({
      data: {
        workspaceId: input.workspaceId,
        createdById: input.createdById,
        name: input.name.slice(0, 200),
        requirement: input.requirement,
        planningStatus: "PLANNING",
      },
      select: { id: true },
    });
    await this.prisma.activityEvent.create({
      data: {
        workspaceId: input.workspaceId,
        actorId: input.createdById,
        action: ActivityActions.PLANNING_STARTED,
        entityType: "workflow",
        entityId: workflow.id,
        details: asJson({ name: input.name.slice(0, 200) }),
      },
    });
    return workflow;
  }

  async savePlan(workflowId: string, workspaceId: string, requirement: DataRequirement, plan: WorkflowPlan): Promise<void> {
    const planHash = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
    await this.prisma.$transaction(async (tx) => {
      await tx.workflowPlan.create({
        data: {
          workspaceId,
          workflowId,
          version: plan.version,
          objective: plan.objective,
          requirement: asJson(requirement),
          constraints: asJson(plan.constraints),
          sourcePolicy: asJson(plan.sourcePolicy),
          searchStrategy: asJson(plan.searchStrategy),
          extractionSchema: asJson(plan.extractionSchema),
          steps: asJson(plan.steps),
          transformations: asJson(plan.transformations),
          validationRules: asJson(plan.validationRules),
          deduplicationRules: asJson(plan.deduplicationRules),
          outputConfiguration: asJson(plan.outputConfiguration),
          completionCriteria: asJson(plan.completionCriteria),
          planHash,
        },
      });
      await tx.workflow.update({
        where: { id: workflowId },
        data: { planningStatus: "PLANNED", planningErrorCode: null, planningErrorMessage: null },
      });
      await tx.activityEvent.create({
        data: {
          workspaceId,
          action: ActivityActions.PLAN_CREATED,
          entityType: "workflow",
          entityId: workflowId,
          details: asJson({
            version: plan.version,
            objective: plan.objective,
            stepCount: plan.steps.length,
          }),
        },
      });
    });
  }

  async markPlanningFailed(workflowId: string, code: string, message: string): Promise<void> {
    await this.prisma.workflow.update({
      where: { id: workflowId },
      data: { planningStatus: "FAILED", planningErrorCode: code.slice(0, 100), planningErrorMessage: message.slice(0, 1000) },
    });
  }
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
