export type WorkflowStatus = "planning" | "running" | "completed" | "failed" | "paused";

export type StageKey =
  | "understand"
  | "discover"
  | "collect"
  | "extract"
  | "validate"
  | "dedupe"
  | "build";

export interface StageState {
  key: StageKey;
  label: string;
  status: "pending" | "active" | "done" | "error";
}

export interface DataField {
  name: string;
  type: "text" | "url" | "number" | "email";
  required: boolean;
}

export interface DataContract {
  entity: string;
  fields: DataField[];
  filters: string[];
  sourceTypes: string[];
  targetCount: number;
}

export interface Workflow {
  id: string;
  name: string;
  prompt: string;
  status: WorkflowStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  durationSec?: number;
  recordsFound: number;
  validRecords: number;
  duplicates: number;
  sourcesProcessed: number;
  sourcesTotal: number;
  stages: StageState[];
  datasetId?: string;
  contract: DataContract;
}

export interface SourceRecord {
  id: string;
  url: string;
  domain: string;
  title: string;
  type: string;
  status: "accepted" | "skipped";
  reason?: string;
  retrievedAt: string;
  recordsContributed: number;
  reliability: "high" | "medium" | "low";
  snippet: string;
}

export interface DatasetRow {
  id: string;
  data: Record<string, string | number>;
  sourceIds: string[];
  confidence: number;
  isValid: boolean;
  collectedAt: string;
}

export interface Dataset {
  id: string;
  workflowId: string;
  name: string;
  description: string;
  recordCount: number;
  sourceCount: number;
  status: "ready" | "partial";
  createdAt: string;
  updatedAt: string;
  fields: DataField[];
  rows: DatasetRow[];
}

export interface ActivityItem {
  id: string;
  icon: "start" | "source" | "collect" | "validate" | "dedupe" | "dataset" | "export";
  text: string;
  workflowId?: string;
  timestamp: string;
}
