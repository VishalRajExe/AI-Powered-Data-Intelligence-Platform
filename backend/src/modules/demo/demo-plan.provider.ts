import type { WorkflowPlanProvider } from "../planner/provider.js";
import type { WorkflowPlanDraft } from "../planner/workflow-plan.schema.js";
import type { DataRequirement } from "../requirements/requirement.schema.js";
import { resolveDemoScenario } from "./scenarios.data.js";

export class DemoWorkflowPlanProvider implements WorkflowPlanProvider {
  async generatePlan(requirement: DataRequirement): Promise<WorkflowPlanDraft> {
    const scenario = resolveDemoScenario(requirement.objective ?? requirement.entityType ?? "");
    return JSON.parse(JSON.stringify(scenario.plan)) as WorkflowPlanDraft;
  }
}
