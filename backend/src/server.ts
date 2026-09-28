import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadEnvConfig } from "./config/env.js";
import { createPrismaClient } from "./db/prisma.js";
import { createLogger } from "./logger.js";
import { createRedisConnection } from "./queue/connection.js";
import { createWorkflowQueue } from "./queue/workflowQueue.js";
import { createRequirementParser } from "./modules/requirements/index.js";
import { createWorkflowPlanner } from "./modules/planner/index.js";
import { FirecrawlAgentAdapter } from "./agent/FirecrawlAgentAdapter.js";
import { WorkflowExecutionRepository } from "./db/repositories/workflow-execution.repository.js";
import { WorkflowExecutionService } from "./modules/workflows/workflow-execution.service.js";
import { SourcePolicyService } from "./modules/sources/SourcePolicyService.js";
import { SourceValidator } from "./modules/sources/SourceValidator.js";
import { RobotsPolicyService } from "./modules/sources/RobotsPolicyService.js";
import { RateLimitService } from "./modules/sources/RateLimitService.js";
import { RetryPolicy } from "./modules/sources/RetryPolicy.js";
import { WorkflowSourceRepository } from "./db/repositories/workflow-source.repository.js";

const config = loadEnvConfig();
process.env.DATABASE_URL = config.DATABASE_URL;

const logger = createLogger(config.LOG_LEVEL, config.APP_ENV);
const prisma = createPrismaClient();
const redis = createRedisConnection(config.REDIS_URL);
const workflowQueue = createWorkflowQueue(redis);
const requirementParser = createRequirementParser(config, logger);
const workflowPlanner = createWorkflowPlanner(config, logger, prisma);
const sourcePolicy = new SourcePolicyService(
  new SourceValidator(),
  new RobotsPolicyService({ userAgent: config.SOURCE_ROBOTS_USER_AGENT, timeoutMs: config.SOURCE_ROBOTS_TIMEOUT_MS }),
  new RateLimitService({ eval: (script, numberOfKeys, ...args) => redis.eval(script, numberOfKeys, ...args.map(String)) }),
  new RetryPolicy(),
  new WorkflowSourceRepository(prisma),
  logger,
);
const agentAdapter = new FirecrawlAgentAdapter(config, logger, undefined, undefined, sourcePolicy);
const app = createApp({
  config,
  logger,
  requirementParser,
  workflowPlanner,
  workflowExecution: new WorkflowExecutionService(requirementParser, workflowPlanner, agentAdapter, new WorkflowExecutionRepository(prisma)),
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
    await Promise.allSettled([workflowQueue.close(), redis.quit(), prisma.$disconnect()]);
    clearTimeout(forceExit);
    process.exit(error ? 1 : 0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
