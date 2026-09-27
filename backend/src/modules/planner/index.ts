import type { Logger } from "pino";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../../config/env.js";
import { WorkflowPlannerRepository } from "../../db/repositories/workflow-planner.repository.js";
import { AiSdkWorkflowPlanProvider } from "./provider.js";
import { WorkflowPlannerService } from "./planner.service.js";

export function createWorkflowPlanner(config: AppConfig, logger: Logger, prisma: PrismaClient): WorkflowPlannerService {
  return new WorkflowPlannerService(new AiSdkWorkflowPlanProvider(config, logger), new WorkflowPlannerRepository(prisma), logger);
}

export { WorkflowPlannerService } from "./planner.service.js";
export type { WorkflowPlanner } from "./planner.service.js";
export { PlanWorkflowRequestSchema, WorkflowPlanDraftSchema, WorkflowPlanSchema } from "./workflow-plan.schema.js";
export type { PlanWorkflowRequest, WorkflowPlan, WorkflowPlanDraft } from "./workflow-plan.schema.js";
export type { WorkflowPlanProvider } from "./provider.js";
