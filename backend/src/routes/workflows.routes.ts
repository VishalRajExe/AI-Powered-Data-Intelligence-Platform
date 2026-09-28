import { Router } from "express";
import { validateRequest } from "../common/validateRequest.js";
import type { WorkflowPlanner } from "../modules/planner/planner.service.js";
import { PlanWorkflowRequestSchema, type PlanWorkflowRequest } from "../modules/planner/workflow-plan.schema.js";
import type { WorkflowExecutionServiceContract } from "../modules/workflows/workflow-execution.service.js";
import { z } from "zod";
import { AppError } from "../common/errors.js";

const ExecuteWorkflowRequestSchema = z.object({
  prompt: z.string().trim().min(5).max(4_000),
  workspaceId: z.string().uuid(),
  createdById: z.string().uuid(),
}).strict();

export function createWorkflowsRouter(planner: WorkflowPlanner, execution: WorkflowExecutionServiceContract): Router {
  const router = Router();
  router.post("/workflows/plan", validateRequest({ body: PlanWorkflowRequestSchema }), async (_request, response) => {
    const validated = response.locals.validated as { body: PlanWorkflowRequest };
    const result = await planner.plan(validated.body);
    response.status(201).json(result);
  });
  router.post("/workflows/execute", validateRequest({ body: ExecuteWorkflowRequestSchema }), async (_request, response) => {
    const validated = response.locals.validated as { body: z.infer<typeof ExecuteWorkflowRequestSchema> };
    const result = await execution.execute(validated.body);
    response.status(202).json(result);
  });
  router.post("/workflows/:id/run", validateRequest({ params: z.object({ id: z.string().uuid() }), body: z.object({ workspaceId: z.string().uuid(), createdById: z.string().uuid() }).strict() }), async (request, response) => {
    const validated = response.locals.validated as { params: { id: string }; body: { workspaceId: string; createdById: string } };
    if (!execution.runWorkflow) throw new AppError("Workflow run queue is unavailable.", 503, "QUEUE_UNAVAILABLE");
    const result = await execution.runWorkflow({ workflowId: validated.params.id, ...validated.body });
    response.status(202).json(result);
  });
  return router;
}
