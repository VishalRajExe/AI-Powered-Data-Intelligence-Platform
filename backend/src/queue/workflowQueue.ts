import { Queue, Worker, type Processor, type WorkerOptions } from "bullmq";
import type { Redis } from "ioredis";

export const WORKFLOW_QUEUE_NAME = "workflow-runs";

export function createWorkflowQueue(connection: Redis): Queue {
  return new Queue(WORKFLOW_QUEUE_NAME, { connection });
}

export function createWorkflowWorker<DataType = unknown, ResultType = unknown>(
  connection: Redis,
  processor: Processor<DataType, ResultType>,
  options: Omit<WorkerOptions, "connection"> = {},
): Worker<DataType, ResultType> {
  return new Worker(WORKFLOW_QUEUE_NAME, processor, { ...options, connection });
}
