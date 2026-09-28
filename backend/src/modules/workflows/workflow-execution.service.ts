import type { AgentAdapter, AgentExecutionEvent, AgentResult } from "../../agent/types.js";
import type { WorkflowExecutionStore } from "../../db/repositories/workflow-execution.repository.js";
import { AppError } from "../../common/errors.js";
import type { RequirementParser } from "../requirements/parser.service.js";
import type { WorkflowPlanner } from "../planner/planner.service.js";

export interface ExecuteWorkflowInput {
  prompt: string;
  workspaceId: string;
  createdById: string;
  onEvent?: (event: AgentExecutionEvent) => void;
}

export interface WorkflowExecutionServiceContract {
  execute(input: ExecuteWorkflowInput): Promise<{
    workflowId: string;
    runId: string;
    requirement: Awaited<ReturnType<RequirementParser["parse"]>>;
    plan: Awaited<ReturnType<WorkflowPlanner["plan"]>>["plan"];
    result: AgentResult;
  }>;
}

export class WorkflowExecutionService implements WorkflowExecutionServiceContract {
  constructor(
    private readonly requirementParser: RequirementParser,
    private readonly workflowPlanner: WorkflowPlanner,
    private readonly agentAdapter: AgentAdapter,
    private readonly store: WorkflowExecutionStore,
  ) {}

  async execute(input: ExecuteWorkflowInput) {
    const requirement = await this.requirementParser.parse(input.prompt);
    if (requirement.validationStatus !== "valid") {
      throw new AppError("Clarification is required before collection can start.", 422, "REQUIREMENT_NEEDS_CLARIFICATION", requirement);
    }
    const planned = await this.workflowPlanner.plan({
      workspaceId: input.workspaceId,
      createdById: input.createdById,
      requirement: requirement.parsedRequirement,
      originalPrompt: input.prompt,
    });
    const run = await this.store.createRun({
      workspaceId: input.workspaceId,
      createdById: input.createdById,
      workflowId: planned.workflowId,
      planVersion: planned.plan.version,
    });
    let result: AgentResult;
    try {
      result = await this.agentAdapter.execute({
        prompt: input.prompt,
        plan: planned.plan,
        workspaceId: input.workspaceId,
        runId: run.id,
        ...(input.onEvent ? { onEvent: input.onEvent } : {}),
      });
    } catch {
      await this.store.completeRun(run.id, failedResult());
      throw new AppError("Workflow agent execution failed.", 502, "AGENT_EXECUTION_FAILED", { workflowId: planned.workflowId, runId: run.id });
    }
    await this.store.completeRun(run.id, result);
    return { workflowId: planned.workflowId, runId: run.id, requirement, plan: planned.plan, result };
  }
}

function failedResult(): AgentResult {
  const now = new Date().toISOString();
  return {
    status: "FAILED", data: null, records: [], sources: [], events: [],
    execution: { provider: "unknown", model: "unknown", startedAt: now, finishedAt: now, durationMs: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, toolCallCount: 0, toolsUsed: [] },
    errors: [{ code: "AGENT_EXECUTION_FAILED", message: "Workflow agent execution failed.", retryable: true }],
  };
}
