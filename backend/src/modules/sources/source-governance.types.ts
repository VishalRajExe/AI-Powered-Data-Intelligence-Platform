import type { SourceStatus } from "@prisma/client";
import type { WorkflowPlan } from "../planner/workflow-plan.schema.js";

export type SourceLifecycleStatus = SourceStatus;
export type RetryableErrorCode = "TIMEOUT" | "RATE_LIMIT" | "TRANSIENT_NETWORK" | "SERVER_ERROR";

export interface SourceRuleSet {
  allowedDomains: string[];
  blockedDomains: string[];
}

export interface SourceDecision {
  allowed: boolean;
  status: "ALLOWED" | "BLOCKED" | "SKIPPED";
  code?: string;
  reason: string;
  canonicalUrl: string;
  domain: string;
}

export interface SourcePolicyContext {
  workspaceId: string;
  workflowRunId: string;
  plan: WorkflowPlan;
}

export interface SourceLifecycleInput {
  workspaceId: string;
  workflowRunId: string;
  url: string;
  canonicalUrl: string;
  canonicalUrlHash: string;
  domain: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface SourceLifecycleUpdate {
  status: SourceLifecycleStatus;
  code?: string | null;
  reason?: string | null;
  robotsStatus?: string | null;
  robotsCheckedAt?: Date | null;
  attemptCount?: number;
  attemptedAt?: Date;
  retrievedAt?: Date;
  title?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SourceLifecycleStore {
  upsertDiscovered(input: SourceLifecycleInput): Promise<{ id: string }>;
  updateLifecycle(workspaceId: string, workflowRunId: string, canonicalUrlHash: string, update: SourceLifecycleUpdate): Promise<void>;
}

export interface RobotsDecision {
  allowed: boolean;
  status: "ALLOWED" | "DISALLOWED" | "UNAVAILABLE" | "NOT_FOUND";
  reason: string;
  checkedAt: Date;
  crawlDelayMs?: number;
}

export interface SourceExecutionPolicy {
  maxAttempts: number;
  backoff: "none" | "exponential";
  initialDelayMs: number;
  multiplier: number;
  maxDelayMs: number;
  retryableErrors: RetryableErrorCode[];
}

export interface SourcePolicyPlanView {
  sourcePolicy: WorkflowPlan["sourcePolicy"];
  steps: WorkflowPlan["steps"];
}
