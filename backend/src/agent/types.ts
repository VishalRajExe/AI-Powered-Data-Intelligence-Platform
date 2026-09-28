import type { AgentEvent } from "@aidp/firecrawl-agent-core";
import type { WorkflowPlan } from "../modules/planner/workflow-plan.schema.js";
import type { DataQualityAssessment, RecordQualityMetadata } from "../modules/data-intelligence/types.js";

export type AgentExecutionStatus = "COMPLETED" | "PARTIAL" | "FAILED";

export interface AgentExecutionEvent {
  runId: string;
  sequence: number;
  type: "agent.progress" | "agent.tool.started" | "agent.tool.completed" | "agent.completed" | "agent.failed";
  occurredAt: string;
  toolName?: string;
  workflowStepType?: "SEARCH" | "SCRAPE" | "INTERACT" | "EXTRACT" | "TRANSFORM";
  summary: string;
  details?: Record<string, unknown>;
}

export interface AgentSourceMetadata {
  url: string;
  canonicalUrl: string;
  domain: string;
  title?: string;
  snippet?: string;
  sourceType: "search" | "scrape" | "interact" | "model_reported";
  retrievedAt: string;
  verifiedByTool: boolean;
}

export interface AgentRecord {
  values: Record<string, unknown>;
  rawValues?: Record<string, unknown>;
  sourceUrls: string[];
  isValid?: boolean;
  validationIssues?: Array<{ fieldKey?: string; ruleCode: string; severity: "ERROR" | "WARNING"; message: string }>;
  quality?: RecordQualityMetadata;
}

export interface AgentExecutionError {
  code: string;
  message: string;
  toolName?: string;
  retryable: boolean;
}

export interface AgentExecutionMetadata {
  provider: string;
  model: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  toolCallCount: number;
  toolsUsed: string[];
}

export interface AgentResult {
  status: AgentExecutionStatus;
  data: unknown;
  records: AgentRecord[];
  sources: AgentSourceMetadata[];
  execution: AgentExecutionMetadata;
  events: AgentExecutionEvent[];
  errors: AgentExecutionError[];
  dataQuality?: DataQualityAssessment;
}

export interface AgentConfigurationHealth {
  configured: boolean;
  provider: string;
  model: string | null;
  missing: string[];
}

export interface AgentExecutionInput {
  prompt: string;
  plan: WorkflowPlan;
  workspaceId?: string;
  runId?: string;
  stepType?: "SEARCH" | "SCRAPE" | "INTERACT" | "EXTRACT";
  sourceUrls?: string[];
  priorRecords?: AgentRecord[];
  onEvent?: (event: AgentExecutionEvent) => void;
}

export interface AgentAdapter {
  checkConfiguration(): AgentConfigurationHealth;
  execute(input: AgentExecutionInput): Promise<AgentResult>;
}

export type FirecrawlAgentEvent = AgentEvent;
