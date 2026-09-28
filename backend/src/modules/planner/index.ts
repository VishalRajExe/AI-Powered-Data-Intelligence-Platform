import type { Logger } from "pino";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../../config/env.js";
import { WorkflowPlannerRepository } from "../../db/repositories/workflow-planner.repository.js";
import { AiSdkWorkflowPlanProvider } from "./provider.js";
import { WorkflowPlannerService } from "./planner.service.js";

import { DemoWorkflowPlanProvider } from "../demo/demo-plan.provider.js";

export function createWorkflowPlanner(config: AppConfig, logger: Logger, prisma: PrismaClient): WorkflowPlannerService {
  const hasLlmKey = Boolean(
    config.GOOGLE_GENERATIVE_AI_API_KEY ||
    config.GEMINI_API_KEY ||
    config.ANTHROPIC_API_KEY ||
    config.OPENAI_API_KEY ||
    config.AI_GATEWAY_API_KEY ||
    config.CUSTOM_OPENAI_API_KEY,
  );
  if (config.DEMO_MODE || !hasLlmKey) {
    return new WorkflowPlannerService(new DemoWorkflowPlanProvider(), new WorkflowPlannerRepository(prisma), logger);
  }
  return new WorkflowPlannerService(new AiSdkWorkflowPlanProvider(config, logger), new WorkflowPlannerRepository(prisma), logger);
}

export { WorkflowPlannerService } from "./planner.service.js";
export type { WorkflowPlanner } from "./planner.service.js";
export { PlanWorkflowRequestSchema, WorkflowPlanDraftSchema, WorkflowPlanSchema } from "./workflow-plan.schema.js";
export type { PlanWorkflowRequest, WorkflowPlan, WorkflowPlanDraft } from "./workflow-plan.schema.js";
export type { WorkflowPlanProvider } from "./provider.js";
