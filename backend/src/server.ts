import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadEnvConfig } from "./config/env.js";
import { createPrismaClient } from "./db/prisma.js";
import { createLogger } from "./logger.js";
import { createRedisConnection } from "./queue/connection.js";
import { createWorkflowQueue, createWorkflowWorker } from "./queue/workflowQueue.js";
import { createRequirementParser } from "./modules/requirements/index.js";
import { createWorkflowPlanner } from "./modules/planner/index.js";
import { FirecrawlAgentAdapter } from "./agent/FirecrawlAgentAdapter.js";
import { DemoAgentAdapter } from "./modules/demo/demo-agent.adapter.js";
import { WorkflowExecutionRepository } from "./db/repositories/workflow-execution.repository.js";
import { WorkflowExecutionService } from "./modules/workflows/workflow-execution.service.js";
import { WorkflowRunner } from "./modules/workflows/workflow-runner.js";
import { SourcePolicyService } from "./modules/sources/SourcePolicyService.js";
import { SourceValidator } from "./modules/sources/SourceValidator.js";
import { RobotsPolicyService } from "./modules/sources/RobotsPolicyService.js";
import { RateLimitService } from "./modules/sources/RateLimitService.js";
import { RetryPolicy } from "./modules/sources/RetryPolicy.js";
import { WorkflowSourceRepository } from "./db/repositories/workflow-source.repository.js";
import { DatasetQueryRepository } from "./db/repositories/dataset-query.repository.js";
import { WorkflowHistoryRepository } from "./db/repositories/workflow-history.repository.js";
import { WorkflowEventBroadcaster } from "./modules/monitoring/event-broadcaster.js";
import { ExportRepository } from "./db/repositories/export.repository.js";
import { ExportService } from "./modules/export/export.service.js";
import { TokenService } from "./modules/auth/token.service.js";
import { AuthService } from "./modules/auth/auth.service.js";

const config = loadEnvConfig();
process.env.DATABASE_URL = config.DATABASE_URL;

const logger = createLogger(config.LOG_LEVEL, config.APP_ENV);
const prisma = createPrismaClient();
const redis = createRedisConnection(config.REDIS_URL);
const redisSubscriber = redis.duplicate();
const eventBroadcaster = new WorkflowEventBroadcaster(prisma, {
  redisPublisher: redis,
  redisSubscriber,
  logger,
});
const workflowHistoryRepository = new WorkflowHistoryRepository(prisma);
const workflowQueue = createWorkflowQueue(redis);
const requirementParser = createRequirementParser(config, logger);
const workflowPlanner = createWorkflowPlanner(config, logger, prisma);
const workflowSourceRepository = new WorkflowSourceRepository(prisma);
const sourcePolicy = new SourcePolicyService(
  new SourceValidator(),
  new RobotsPolicyService({ userAgent: config.SOURCE_ROBOTS_USER_AGENT, timeoutMs: config.SOURCE_ROBOTS_TIMEOUT_MS }),
  new RateLimitService({ eval: (script, numberOfKeys, ...args) => redis.eval(script, numberOfKeys, ...args.map(String)) }),
  new RetryPolicy(),
  workflowSourceRepository,
  logger,
);

const agentAdapter = config.DEMO_MODE
  ? new DemoAgentAdapter(logger, workflowSourceRepository)
  : new FirecrawlAgentAdapter(config, logger, undefined, undefined, sourcePolicy);

if (config.DEMO_MODE) {
  logger.warn("⚡ [DEMO MODE ACTIVE] Backend running in deterministic judge demonstration mode. Live web scraping disabled. Simulated datasets clearly marked.");
}
const workflowRepository = new WorkflowExecutionRepository(prisma, eventBroadcaster);
const datasetQueryRepository = new DatasetQueryRepository(prisma);
const workflowRunner = new WorkflowRunner(workflowRepository, agentAdapter, logger);
const workflowWorker = createWorkflowWorker<{ runId: string }>(redis, async (job) => {
  try {
    await workflowRunner.run(job.data.runId);
  } catch (error) {
    logger.error({ runId: job.data.runId, errorName: error instanceof Error ? error.name : "UnknownError" }, "Workflow worker failed unexpectedly");
    await workflowRepository.failRun(job.data.runId, { code: "WORKER_EXECUTION_FAILED", message: "The workflow worker stopped unexpectedly. Inspect the run steps and retry the workflow." });
    throw error;
  }
}, { concurrency: 2 });
workflowWorker.on("failed", (job, error) => logger.error({ runId: job?.data.runId, errorName: error.name }, "Workflow queue job failed"));
const exportRepository = new ExportRepository(prisma);
const exportService = new ExportService(exportRepository, datasetQueryRepository, { logger });
const jwtAccessSecret =
  config.JWT_ACCESS_SECRET || "default_development_jwt_access_secret_min_32_chars!";
const jwtRefreshSecret =
  config.JWT_REFRESH_SECRET || "default_development_jwt_refresh_secret_min_32_chars!";

const tokenService = new TokenService({
  accessSecret: jwtAccessSecret,
  refreshSecret: jwtRefreshSecret,
  redis,
});
const authService = new AuthService(prisma, tokenService);

const app = createApp({
  config,
  logger,
  requirementParser,
  workflowPlanner,
  workflowExecution: new WorkflowExecutionService(requirementParser, workflowPlanner, workflowRepository, workflowQueue),
  workflowRunRepository: workflowRepository,
  workflowHistoryRepository,
  eventBroadcaster,
  datasetQueryRepository,
  exportRepository,
  exportService,
  authService,
  tokenService,
  agentAdapter,
  readiness: {
    mysql: () => prisma.$queryRaw`SELECT 1`,
    redis: () => redis.ping(),
  },
});

const server = createServer(app);
server.listen(config.PORT, () => {
  logger.info({ port: config.PORT, environment: config.APP_ENV }, "Backend API listening");
});

let isShuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, "Shutting down backend");
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  server.close(async (error) => {
    if (error) logger.error({ err: error }, "HTTP server close failed");
    await Promise.allSettled([workflowWorker.close(), workflowQueue.close(), redis.quit(), redisSubscriber.quit(), prisma.$disconnect()]);
    clearTimeout(forceExit);
    process.exit(error ? 1 : 0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
