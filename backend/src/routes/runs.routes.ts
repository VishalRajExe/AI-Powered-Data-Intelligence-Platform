import { Router } from "express";
import { z } from "zod";
import { validateRequest } from "../common/validateRequest.js";
import type { WorkflowExecutionRepository } from "../db/repositories/workflow-execution.repository.js";

const AccessQuery = z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }).strict();
const CancelBody = z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }).strict();

export function createRunsRouter(repository: WorkflowExecutionRepository): Router {
  const router = Router();
  router.post("/runs/:id/cancel", validateRequest({ params: z.object({ id: z.string().uuid() }), body: CancelBody }), async (request, response) => {
    const { params, body } = response.locals.validated as { params: { id: string }; body: z.infer<typeof CancelBody> };
    response.status(202).json(await repository.requestCancellation(params.id, body.workspaceId, body.userId));
  });
  router.get("/runs/:id", validateRequest({ params: z.object({ id: z.string().uuid() }), query: AccessQuery }), async (_request, response) => {
    const { params, query } = response.locals.validated as { params: { id: string }; query: z.infer<typeof AccessQuery> };
    response.json(await repository.getRun(params.id, query.workspaceId, query.userId));
  });
  router.get("/runs/:id/steps", validateRequest({ params: z.object({ id: z.string().uuid() }), query: AccessQuery }), async (_request, response) => {
    const { params, query } = response.locals.validated as { params: { id: string }; query: z.infer<typeof AccessQuery> };
    response.json({ steps: await repository.getSteps(params.id, query.workspaceId, query.userId) });
  });
  return router;
}
