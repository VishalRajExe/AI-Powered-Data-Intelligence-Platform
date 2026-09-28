import { Router } from "express";
import { validateRequest } from "../common/validateRequest.js";
import type { WorkflowPlanner } from "../modules/planner/planner.service.js";
import { PlanWorkflowRequestSchema, type PlanWorkflowRequest } from "../modules/planner/workflow-plan.schema.js";
import type { WorkflowExecutionServiceContract } from "../modules/workflows/workflow-execution.service.js";
import type { WorkflowHistoryRepository } from "../db/repositories/workflow-history.repository.js";
import { z } from "zod";
import { AppError } from "../common/errors.js";

const UUIDParam = z.object({ id: z.string().uuid() });

const ExecuteWorkflowRequestSchema = z.object({
  prompt: z.string().trim().min(5).max(4_000),
  workspaceId: z.string().uuid(),
  createdById: z.string().uuid(),
}).strict();

const ListWorkflowsQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  status: z.string().trim().optional(),
});

const WorkflowAccessQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
}).strict();

const WorkflowRunsQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function createWorkflowsRouter(
  planner: WorkflowPlanner,
  execution: WorkflowExecutionServiceContract,
  historyRepository?: WorkflowHistoryRepository,
): Router {
  const router = Router();

  // POST /workflows/plan
  router.post("/workflows/plan", validateRequest({ body: PlanWorkflowRequestSchema }), async (_request, response) => {
    const validated = response.locals.validated as { body: PlanWorkflowRequest };
    const result = await planner.plan(validated.body);
    response.status(201).json(result);
  });

  // POST /workflows/execute
  router.post("/workflows/execute", validateRequest({ body: ExecuteWorkflowRequestSchema }), async (_request, response) => {
    const validated = response.locals.validated as { body: z.infer<typeof ExecuteWorkflowRequestSchema> };
    const result = await execution.execute(validated.body);
    response.status(202).json(result);
  });

  // POST /workflows/:id/run
  router.post(
    "/workflows/:id/run",
    validateRequest({
      params: UUIDParam,
      body: z.object({ workspaceId: z.string().uuid(), createdById: z.string().uuid() }).strict(),
    }),
    async (request, response) => {
      const validated = response.locals.validated as { params: { id: string }; body: { workspaceId: string; createdById: string } };
      if (!execution.runWorkflow) throw new AppError("Workflow run queue is unavailable.", 503, "QUEUE_UNAVAILABLE");
      const result = await execution.runWorkflow({ workflowId: validated.params.id, ...validated.body });
      response.status(202).json(result);
    },
  );

  // GET /workflows — List workflows with last run, dataset, and number of runs
  router.get(
    "/workflows",
    validateRequest({ query: ListWorkflowsQuerySchema }),
    async (_request, response) => {
      if (!historyRepository) {
        throw new AppError("Workflow history is unavailable.", 503, "HISTORY_UNAVAILABLE");
      }
      const { query } = response.locals.validated as { query: z.infer<typeof ListWorkflowsQuerySchema> };
      const result = await historyRepository.listWorkflows(query.workspaceId, query.userId, query);
      const enrichedData = result.items.map((item) => ({
        ...item,
        prompt: item.originalPrompt || item.requirement || "",
        validRecords: item.lastRun?.recordsAccepted ?? item.dataset?.validCount ?? 0,
        recordsFound: item.lastRun?.recordsFound ?? item.dataset?.recordCount ?? 0,
        duplicates: item.lastRun?.duplicates ?? item.dataset?.duplicateCount ?? 0,
        sourcesProcessed: item.lastRun?.sourceCount ?? item.dataset?.sourceCount ?? 0,
        progress: item.lastRun?.status === "COMPLETED" ? 100 : item.lastRun?.status === "RUNNING" ? 50 : 0,
      }));
      response.json({
        ...result,
        data: enrichedData,
      });
    },
  );

  // GET /workflows/:id — Detailed workflow view
  router.get(
    "/workflows/:id",
    validateRequest({ params: UUIDParam, query: WorkflowAccessQuerySchema }),
    async (_request, response) => {
      if (!historyRepository) {
        throw new AppError("Workflow history is unavailable.", 503, "HISTORY_UNAVAILABLE");
      }
      const { params, query } = response.locals.validated as {
        params: z.infer<typeof UUIDParam>;
        query: z.infer<typeof WorkflowAccessQuerySchema>;
      };
      const wf = await historyRepository.getWorkflow(query.workspaceId, params.id, query.userId);
      const enrichedWf = {
        ...wf,
        prompt: wf.requirement || wf.originalPrompt || "",
        lastRun: wf.lastRun
          ? {
              ...wf.lastRun,
              validRecords: wf.lastRun.recordsAccepted,
              sourcesProcessed: wf.lastRun.sourceCount,
              datasetId: wf.dataset?.id,
            }
          : null,
      };
      response.json(enrichedWf);
    },
  );

  // GET /workflows/:id/runs — List runs for a workflow
  router.get(
    "/workflows/:id/runs",
    validateRequest({ params: UUIDParam, query: WorkflowRunsQuerySchema }),
    async (_request, response) => {
      if (!historyRepository) {
        throw new AppError("Workflow history is unavailable.", 503, "HISTORY_UNAVAILABLE");
      }
      const { params, query } = response.locals.validated as {
        params: z.infer<typeof UUIDParam>;
        query: z.infer<typeof WorkflowRunsQuerySchema>;
      };
      response.json(await historyRepository.getWorkflowRuns(query.workspaceId, params.id, query.userId, query));
    },
  );

  // DELETE /workflows/:id — Delete workflow and associated runs/datasets
  router.delete(
    "/workflows/:id",
    validateRequest({ params: UUIDParam, query: WorkflowAccessQuerySchema }),
    async (_request, response) => {
      if (!historyRepository) {
        throw new AppError("Workflow history is unavailable.", 503, "HISTORY_UNAVAILABLE");
      }
      const { params, query } = response.locals.validated as {
        params: z.infer<typeof UUIDParam>;
        query: z.infer<typeof WorkflowAccessQuerySchema>;
      };
      response.json(await historyRepository.deleteWorkflow(query.workspaceId, params.id, query.userId));
    },
  );

  return router;
}
