import { Router } from "express";
import { validateRequest } from "../common/validateRequest.js";
import type { WorkflowPlanner } from "../modules/planner/planner.service.js";
import { PlanWorkflowRequestSchema, type PlanWorkflowRequest } from "../modules/planner/workflow-plan.schema.js";

export function createWorkflowsRouter(planner: WorkflowPlanner): Router {
  const router = Router();
  router.post("/workflows/plan", validateRequest({ body: PlanWorkflowRequestSchema }), async (_request, response) => {
    const validated = response.locals.validated as { body: PlanWorkflowRequest };
    const result = await planner.plan(validated.body);
    response.status(201).json(result);
  });
  return router;
}
