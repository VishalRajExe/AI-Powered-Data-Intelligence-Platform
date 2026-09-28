import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";
import type { AppConfig } from "./config/env.js";
import { createErrorHandler, notFoundHandler } from "./common/errors.js";
import { requestIdMiddleware } from "./common/requestId.js";
import { createHealthRouter, type ReadinessProbes } from "./routes/health.routes.js";
import { createRequirementsRouter } from "./routes/requirements.routes.js";
import type { RequirementParser } from "./modules/requirements/parser.service.js";
import { createWorkflowsRouter } from "./routes/workflows.routes.js";
import type { WorkflowPlanner } from "./modules/planner/planner.service.js";
import type { AgentAdapter } from "./agent/types.js";
import type { WorkflowExecutionServiceContract } from "./modules/workflows/workflow-execution.service.js";
import { createRunsRouter } from "./routes/runs.routes.js";
import type { WorkflowExecutionRepository } from "./db/repositories/workflow-execution.repository.js";
import { createDatasetsRouter } from "./routes/datasets.routes.js";
import type { DatasetQueryRepository } from "./db/repositories/dataset-query.repository.js";

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  readiness: ReadinessProbes;
  requirementParser: RequirementParser;
  workflowPlanner: WorkflowPlanner;
  workflowExecution: WorkflowExecutionServiceContract;
  workflowRunRepository?: WorkflowExecutionRepository;
  datasetQueryRepository?: DatasetQueryRepository;
  agentAdapter: AgentAdapter;
}

export function createApp(dependencies: AppDependencies): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({
    origin: (origin, callback) => callback(null, !origin || origin.replace(/\/$/, "") === dependencies.config.FRONTEND_ORIGIN),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID", "Last-Event-ID"],
  }));
  app.use(requestIdMiddleware);
  app.use(pinoHttp({
    logger: dependencies.logger,
    genReqId: (_request, response) => String(response.getHeader("X-Request-ID")),
    serializers: {
      req: (request) => ({ id: request.id, method: request.method, path: request.url?.split("?")[0] }),
      res: (response) => ({ statusCode: response.statusCode }),
    },
  }));
  app.use(express.json({ limit: dependencies.config.REQUEST_BODY_LIMIT }));
  app.use(createHealthRouter(dependencies.readiness, () => dependencies.agentAdapter.checkConfiguration()));
  app.use("/api/v1", createRequirementsRouter(dependencies.requirementParser));
  app.use("/api/v1", createWorkflowsRouter(dependencies.workflowPlanner, dependencies.workflowExecution));
  if (dependencies.workflowRunRepository) app.use("/api/v1", createRunsRouter(dependencies.workflowRunRepository));
  if (dependencies.datasetQueryRepository) app.use("/api/v1", createDatasetsRouter(dependencies.datasetQueryRepository));
  app.use(notFoundHandler());
  app.use(createErrorHandler(dependencies.logger));
  return app;
}
