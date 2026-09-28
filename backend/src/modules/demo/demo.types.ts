import type { DataRequirement } from "../requirements/requirement.schema.js";
import type { WorkflowPlanDraft } from "../planner/workflow-plan.schema.js";
import type { AgentSourceMetadata, AgentRecord } from "../../agent/types.js";

export interface DemoScenarioDefinition {
  id: string;
  name: string;
  scenarioNumber: 1 | 2 | 3;
  canonicalPrompt: string;
  description: string;
  match: (prompt: string) => boolean;
  requirement: DataRequirement;
  plan: WorkflowPlanDraft;
  sources: AgentSourceMetadata[];
  records: AgentRecord[];
  expectedMetrics: {
    targetCount: number;
    rawRecordCount: number;
    validRecordCount: number;
    duplicateCount: number;
    conflictCount: number;
    sourceCount: number;
  };
}
