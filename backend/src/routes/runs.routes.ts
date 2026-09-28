import { Router } from "express";
import { z } from "zod";
import { validateRequest } from "../common/validateRequest.js";
import type { WorkflowExecutionRepository } from "../db/repositories/workflow-execution.repository.js";
import type { WorkflowHistoryRepository } from "../db/repositories/workflow-history.repository.js";
import type { WorkflowEventBroadcaster } from "../modules/monitoring/event-broadcaster.js";
import type { RunActivityEvent } from "../modules/monitoring/monitoring.types.js";

const UUIDParam = z.object({ id: z.string().uuid() });
const AccessQuery = z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }).strict();
const CancelBody = z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }).strict();
const EventsQuery = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  lastEventId: z.string().optional(),
});

export function createRunsRouter(
  repository: WorkflowExecutionRepository,
  historyRepository?: WorkflowHistoryRepository,
  broadcaster?: WorkflowEventBroadcaster,
): Router {
  const router = Router();

  // POST /runs/:id/cancel
  router.post(
    "/runs/:id/cancel",
    validateRequest({ params: UUIDParam, body: CancelBody }),
    async (_request, response) => {
      const { params, body } = response.locals.validated as { params: { id: string }; body: z.infer<typeof CancelBody> };
      response.status(202).json(await repository.requestCancellation(params.id, body.workspaceId, body.userId));
    },
  );

  // GET /runs/:id — WorkflowRun with duration, records found, records accepted, duplicates, failures, source count
  router.get(
    "/runs/:id",
    validateRequest({ params: UUIDParam, query: AccessQuery }),
    async (_request, response) => {
      const { params, query } = response.locals.validated as { params: { id: string }; query: z.infer<typeof AccessQuery> };
      let run: any;
      if (historyRepository) {
        run = await historyRepository.getRun(query.workspaceId, params.id, query.userId);
      } else {
        run = await repository.getRun(params.id, query.workspaceId, query.userId);
      }
      response.json({
        ...run,
        datasetId: run.dataset?.id ?? run.datasetId,
        validRecords: run.recordsAccepted ?? run.recordsValid ?? 0,
        sourcesProcessed: run.sourceCount ?? run.sourcesProcessed ?? 0,
        duplicates: run.duplicates ?? run.duplicateCount ?? 0,
      });
    },
  );

  // GET /runs/:id/steps
  router.get(
    "/runs/:id/steps",
    validateRequest({ params: UUIDParam, query: AccessQuery }),
    async (_request, response) => {
      const { params, query } = response.locals.validated as { params: { id: string }; query: z.infer<typeof AccessQuery> };
      response.json({ steps: await repository.getSteps(params.id, query.workspaceId, query.userId) });
    },
  );

  // GET /runs/:id/activity — Persisted durable activity events from MySQL
  router.get(
    "/runs/:id/activity",
    validateRequest({ params: UUIDParam, query: AccessQuery }),
    async (_request, response) => {
      const { params, query } = response.locals.validated as { params: { id: string }; query: z.infer<typeof AccessQuery> };
      let rawEvents: any[] = [];
      if (historyRepository) {
        rawEvents = await historyRepository.getRunActivity(query.workspaceId, params.id, query.userId);
      } else if (broadcaster) {
        rawEvents = await broadcaster.getHistory(query.workspaceId, params.id);
      }
      const events = rawEvents.map((ev: any) => ({
        ...ev,
        timestamp: ev.createdAt || ev.timestamp || new Date().toISOString(),
        message: ev.message || (ev.details && typeof ev.details === "object" && typeof ev.details?.message === "string" ? ev.details.message : undefined),
      }));
      response.json({ events });
    },
  );

  // GET /runs/:id/events — Server-Sent Events (SSE) for live monitoring
  router.get(
    "/runs/:id/events",
    validateRequest({ params: UUIDParam, query: EventsQuery }),
    async (request, response) => {
      const { params, query } = response.locals.validated as { params: { id: string }; query: z.infer<typeof EventsQuery> };

      // 1. Verify access and run existence
      let run: { status: string };
      if (historyRepository) {
        run = await historyRepository.getRun(query.workspaceId, params.id, query.userId);
      } else {
        run = await repository.getRun(params.id, query.workspaceId, query.userId);
      }

      // 2. Establish SSE Stream Headers
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.flushHeaders();

      let isClosed = false;
      const sendEvent = (event: RunActivityEvent) => {
        if (isClosed) return;
        response.write(`id: ${event.id}\nevent: ${event.action}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      // 3. Replay persisted historical events from MySQL
      const lastEventId = query.lastEventId ?? (request.headers["last-event-id"] as string | undefined);
      if (broadcaster) {
        const history = await broadcaster.getHistory(query.workspaceId, params.id, lastEventId);
        for (const ev of history) {
          sendEvent(ev);
        }
      } else if (historyRepository) {
        const history = await historyRepository.getRunActivity(query.workspaceId, params.id, query.userId);
        for (const ev of history) {
          sendEvent(ev);
        }
      }

      // 4. If run has already finished, close the stream gracefully
      if (["COMPLETED", "FAILED", "CANCELLED", "PARTIAL"].includes(run.status)) {
        response.end();
        return;
      }

      // 5. If run is still active, subscribe to live updates (local + Redis)
      let unsubscribe: (() => Promise<void>) | undefined;
      if (broadcaster) {
        unsubscribe = await broadcaster.subscribe(params.id, (event) => {
          sendEvent(event);
          if (["RUN_COMPLETED", "RUN_FAILED", "RUN_CANCELLED"].includes(event.action)) {
            setTimeout(() => {
              if (!isClosed) {
                isClosed = true;
                clearInterval(heartbeat);
                response.end();
              }
            }, 300);
          }
        });
      }

      // 6. Keep-alive heartbeat every 15 seconds
      const heartbeat = setInterval(() => {
        if (!isClosed) {
          response.write(": ping\n\n");
        }
      }, 15_000);

      // 7. Cleanup on client disconnection
      request.on("close", async () => {
        isClosed = true;
        clearInterval(heartbeat);
        if (unsubscribe) {
          await unsubscribe();
        }
      });
    },
  );

  return router;
}
