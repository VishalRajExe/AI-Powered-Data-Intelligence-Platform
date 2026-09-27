import type { Logger } from "pino";
import { AppError } from "../../common/errors.js";
import type { WorkflowPlannerStore } from "../../db/repositories/workflow-planner.repository.js";
import { DataRequirementSchema, type DataRequirement } from "../requirements/requirement.schema.js";
import { WorkflowPlanSchema, WorkflowPlanDraftSchema, type PlanWorkflowRequest, type WorkflowPlan } from "./workflow-plan.schema.js";
import type { WorkflowPlanProvider } from "./provider.js";

export interface WorkflowPlanner {
  plan(input: PlanWorkflowRequest): Promise<{ workflowId: string; plan: WorkflowPlan; planningStatus: "PLANNED" }>;
}

export class WorkflowPlannerService implements WorkflowPlanner {
  constructor(
    private readonly provider: WorkflowPlanProvider,
    private readonly store: WorkflowPlannerStore,
    private readonly logger?: Logger,
  ) {}

  async plan(input: PlanWorkflowRequest) {
    const parsedRequirement = DataRequirementSchema.safeParse(input.requirement);
    if (!parsedRequirement.success) throw new AppError("Structured requirement is invalid", 400, "INVALID_REQUIREMENT");
    const requirement = parsedRequirement.data;
    const missing = requirementMissingInformation(requirement);
    if (missing.length || requirement.ambiguities.length) {
      throw new AppError("Clarify the requirement before generating a workflow plan.", 422, "REQUIREMENT_NEEDS_CLARIFICATION", {
        missingInformation: missing,
        ambiguities: requirement.ambiguities,
      });
    }

    let workflow: { id: string };
    try {
      workflow = await this.store.createPlanningWorkflow({
        workspaceId: input.workspaceId,
        createdById: input.createdById,
        name: requirement.objective ?? "Data collection workflow",
        requirement: input.originalPrompt ?? requirement.objective ?? JSON.stringify(requirement),
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("Workflow planning could not be initialized.", 503, "WORKFLOW_PLANNER_INITIALIZATION_FAILED");
    }

    let correction: string[] | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let candidate: unknown;
      try {
        candidate = await this.provider.generatePlan(requirement, correction);
      } catch (error) {
        await this.fail(workflow.id, "WORKFLOW_PLANNER_UNAVAILABLE", "Workflow planning provider failed. Please retry.");
        throw error instanceof AppError
          ? new AppError(error.message, error.statusCode, error.code, { workflowId: workflow.id })
          : new AppError("Workflow planning is temporarily unavailable. Please retry.", 503, "WORKFLOW_PLANNER_UNAVAILABLE", { workflowId: workflow.id });
      }

      const draft = WorkflowPlanDraftSchema.safeParse(candidate);
      const complete = draft.success
        ? WorkflowPlanSchema.safeParse({ ...draft.data, version: 1, requirement })
        : undefined;
      if (complete?.success) {
        try {
          await this.store.savePlan(workflow.id, input.workspaceId, requirement, complete.data);
        } catch (error) {
          await this.fail(workflow.id, "WORKFLOW_PLAN_PERSISTENCE_FAILED", "The generated plan could not be saved.");
          this.logger?.error({ workflowId: workflow.id, errorName: error instanceof Error ? error.name : "UnknownError" }, "Workflow plan persistence failed");
          throw new AppError("The workflow plan could not be saved. Please retry.", 503, "WORKFLOW_PLAN_PERSISTENCE_FAILED", { workflowId: workflow.id });
        }
        return { workflowId: workflow.id, plan: complete.data, planningStatus: "PLANNED" as const };
      }

      const issues = (draft.success ? complete?.error.issues : draft.error.issues) ?? [];
      correction = issues.slice(0, 30).map(({ path, message }) => `${path.join(".") || "plan"}: ${message}`);
      this.logger?.warn({ workflowId: workflow.id, attempt: attempt + 1, issueCount: issues.length }, "Workflow plan rejected by validation");
      if (attempt === 0) continue;
      await this.fail(workflow.id, "INVALID_WORKFLOW_PLAN", "Generated workflow plan failed validation after one correction attempt.");
      throw new AppError("The workflow planner returned an invalid plan after one correction attempt.", 502, "INVALID_WORKFLOW_PLAN", {
        workflowId: workflow.id,
        issues: correction,
      });
    }
    throw new AppError("Workflow planning failed", 502, "INVALID_WORKFLOW_PLAN", { workflowId: workflow.id });
  }

  private async fail(workflowId: string, code: string, message: string): Promise<void> {
    try { await this.store.markPlanningFailed(workflowId, code, message); }
    catch (error) {
      this.logger?.error({ workflowId, errorName: error instanceof Error ? error.name : "UnknownError" }, "Could not persist failed workflow planning status");
    }
  }
}

function requirementMissingInformation(requirement: DataRequirement): string[] {
  const missing = [...requirement.missingInformation];
  if (!requirement.objective) missing.push("A clear objective for the requested dataset");
  if (!requirement.entityType) missing.push("The kind of entity or information to collect");
  if (requirement.fields.length === 0) missing.push("At least one requested field or attribute");
  return [...new Set(missing)];
}
