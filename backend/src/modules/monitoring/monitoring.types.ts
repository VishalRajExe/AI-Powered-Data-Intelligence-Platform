export const ActivityActions = {
  PLANNING_STARTED: "PLANNING_STARTED",
  PLAN_CREATED: "PLAN_CREATED",
  SOURCE_DISCOVERY_STARTED: "SOURCE_DISCOVERY_STARTED",
  SOURCE_DISCOVERED: "SOURCE_DISCOVERED",
  SCRAPE_STARTED: "SCRAPE_STARTED",
  SCRAPE_COMPLETED: "SCRAPE_COMPLETED",
  EXTRACTION_STARTED: "EXTRACTION_STARTED",
  RECORDS_EXTRACTED: "RECORDS_EXTRACTED",
  VALIDATION_COMPLETED: "VALIDATION_COMPLETED",
  DEDUPLICATION_COMPLETED: "DEDUPLICATION_COMPLETED",
  DATASET_CREATED: "DATASET_CREATED",
  RUN_COMPLETED: "RUN_COMPLETED",
  RUN_FAILED: "RUN_FAILED",
  RUN_CANCELLED: "RUN_CANCELLED",
  RUN_STARTED: "RUN_STARTED",
} as const;

export type ActivityAction = typeof ActivityActions[keyof typeof ActivityActions] | string;

export interface RunActivityEvent {
  id: string;
  workspaceId: string;
  actorId?: string | null;
  action: ActivityAction;
  entityType: "workflow" | "workflow_run" | "dataset" | string;
  entityId: string;
  details?: Record<string, unknown> | null;
  createdAt: string;
}

export interface WorkflowLastRunSummary {
  id: string;
  status: string;
  started: string | null;
  completed: string | null;
  duration: number; // in milliseconds
  durationMs: number;
  recordsFound: number;
  recordsAccepted: number;
  duplicates: number;
  failures: number;
  sourceCount: number;
}

export interface WorkflowDatasetSummary {
  id: string;
  name: string;
  recordCount: number;
  validCount?: number | undefined;
  duplicateCount?: number | undefined;
  sourceCount?: number | undefined;
  status: string;
  createdAt: string;
}

export interface WorkflowListItem {
  id: string;
  workspaceId: string;
  name: string;
  originalPrompt: string;
  requirement: string;
  createdTime: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  planningStatus: string;
  numberOfRuns: number;
  runsCount: number;
  lastRun: WorkflowLastRunSummary | null;
  dataset: WorkflowDatasetSummary | null;
}

export interface WorkflowDetail extends WorkflowListItem {
  createdById: string;
  planningErrorCode?: string | null | undefined;
  planningErrorMessage?: string | null | undefined;
  latestPlan?: {
    id: string;
    version: number;
    objective: string;
    stepCount: number;
    planHash: string;
    createdAt: string;
  } | null | undefined;
  recentRuns: WorkflowRunView[];
}

export interface WorkflowRunStepView {
  id: string;
  sequence: number;
  type: string;
  status: string;
  attempt: number;
  retryCount: number;
  durationMs: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  outputSummary?: unknown;
  errorCode?: string | null | undefined;
  errorMessage?: string | null | undefined;
}

export interface WorkflowRunView {
  id: string;
  workspaceId: string;
  workflowId: string;
  workflowName?: string | undefined;
  workflowPlanId: string;
  status: string;
  progress: number;
  started: string | null;
  startedAt: string | null;
  completed: string | null;
  finishedAt: string | null;
  duration: number; // milliseconds
  durationMs: number;
  recordsFound: number;
  recordsAccepted: number;
  recordsValid: number;
  duplicates: number;
  duplicateCount: number;
  failures: number;
  sourcesFailed: number;
  sourceCount: number;
  sourcesProcessed: number;
  errorCode?: string | null | undefined;
  errorMessage?: string | null | undefined;
  cancelRequestedAt?: string | null | undefined;
  dataset: WorkflowDatasetSummary | null;
  steps?: WorkflowRunStepView[] | undefined;
  createdAt: string;
  updatedAt: string;
}
