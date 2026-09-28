import type { Queue } from "bullmq";
import { AppError } from "../../common/errors.js";
import type { WorkflowExecutionRepository } from "../../db/repositories/workflow-execution.repository.js";
import type { RequirementParser } from "../requirements/parser.service.js";
import type { WorkflowPlanner } from "../planner/planner.service.js";

export interface EnqueuedWorkflowRun { workflowId: string; runId: string; status: "PENDING"; }

export class WorkflowExecutionService {
  constructor(
    private readonly requirementParser: RequirementParser,
    private readonly workflowPlanner: WorkflowPlanner,
    private readonly store: Pick<WorkflowExecutionRepository, "createRun" | "failRun">,
    private readonly queue: Pick<Queue, "add">,
  ) {}

  async execute(input: { prompt: string; workspaceId: string; createdById: string }): Promise<EnqueuedWorkflowRun & { requirement: unknown; plan: unknown }> {
    const requirement = await this.requirementParser.parse(input.prompt);
    if (requirement.validationStatus !== "valid") throw new AppError("Clarification is required before collection can start.", 422, "REQUIREMENT_NEEDS_CLARIFICATION", requirement);
    const planned = await this.workflowPlanner.plan({ workspaceId: input.workspaceId, createdById: input.createdById, requirement: requirement.parsedRequirement, originalPrompt: input.prompt });
    const run = await this.enqueue(planned.workflowId, input.workspaceId, input.createdById, planned.plan.version);
    return { ...run, requirement, plan: planned.plan };
  }

  async runWorkflow(input: { workflowId: string; workspaceId: string; createdById: string }): Promise<EnqueuedWorkflowRun> {
    return this.enqueue(input.workflowId, input.workspaceId, input.createdById);
  }

  private async enqueue(workflowId: string, workspaceId: string, createdById: string, planVersion?: number): Promise<EnqueuedWorkflowRun> {
    const run = await this.store.createRun({ workspaceId, createdById, workflowId, ...(planVersion === undefined ? {} : { planVersion }) });
    try {
      await this.queue.add("execute-workflow", { runId: run.id }, { jobId: run.id, removeOnComplete: 500, removeOnFail: 1_000 });
    } catch {
      await this.store.failRun(run.id, { code: "QUEUE_ENQUEUE_FAILED", message: "The run could not be added to the background queue." });
      throw new AppError("The workflow run could not be queued.", 503, "QUEUE_UNAVAILABLE", { runId: run.id });
    }
    return { workflowId, runId: run.id, status: "PENDING" };
  }
}

export type WorkflowExecutionServiceContract = Pick<WorkflowExecutionService, "execute"> & Partial<Pick<WorkflowExecutionService, "runWorkflow">>;
