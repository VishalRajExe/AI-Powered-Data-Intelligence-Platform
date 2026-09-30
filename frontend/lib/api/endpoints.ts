import { apiGet, apiPost } from "./client";
import type {
  ActivityResponse,
  DatasetDetails,
  DatasetListResponse,
  EvidenceResponse,
  ExportListResponse,
  ExportRequestResponse,
  ExportView,
  MonitoringResponse,
  PlanResponse,
  RequirementAnalysis,
  RowListResponse,
  RowEvidence,
  RunDetailResponse,
  RunListResponse,
  RunView,
  RecentRunsResponse,
  SchemaResponse,
  SourceListResponse,
  StepHistoryResponse,
  WhoResponse,
  WorkflowCreateResponse,
  WorkflowListResponse,
} from "./types";

/**
 * One call site per backend endpoint, typed against that endpoint's own response.
 *
 * There are no aggregate helpers here on purpose: a screen that needs three facts makes three
 * requests, and the page says which of the three failed rather than presenting a composed number
 * nobody can point at. Nothing in this module invents a value a backend did not return.
 */

// ------------------------------------------------------------------ identity

export interface Credentials {
  email: string;
  password: string;
}

export interface Registration extends Credentials {
  displayName?: string;
}

export const auth = {
  me: (signal?: AbortSignal) => apiGet<WhoResponse>("/auth/me", { signal }),
  login: (body: Credentials) => apiPost<WhoResponse>("/auth/login", body),
  register: (body: Registration) => apiPost<WhoResponse>("/auth/register", body),
  refresh: () => apiPost<WhoResponse>("/auth/refresh"),
  /** 204 with no body: `apiPost` parses JSON, so the response is not read. */
  logout: () => apiPost<void>("/auth/logout"),
};

// ------------------------------------------------------------------ workflows

export interface PromptLimits {
  maxLoops?: number;
  expectedRecords?: number;
  tools?: string[];
  maxInteractionsPerRun?: number;
  maxSearchesPerRun?: number;
  maxScrapesPerRun?: number;
}

export const workflows = {
  list: (query: { status?: string; limit?: number; page?: number }, signal?: AbortSignal) =>
    apiGet<WorkflowListResponse>("/workflows", { query, signal }),
  create: (body: { prompt: string; name?: string }) =>
    apiPost<WorkflowCreateResponse>("/workflows", body),
  plan: (id: string) => apiPost<PlanResponse>(`/workflows/${id}/plan`),
  startRun: (id: string) => apiPost<{ run: RunView }>(`/workflows/${id}/runs`),
  run: (runId: string, signal?: AbortSignal) =>
    apiGet<RunDetailResponse>(`/workflows/runs/${runId}`, { signal }),
  stepHistory: (runId: string, signal?: AbortSignal) =>
    apiGet<StepHistoryResponse>(`/workflows/runs/${runId}/steps`, { signal }),
  cancelRun: (runId: string) =>
    apiPost<{ run: RunView }>(`/workflows/runs/${runId}/cancel`),
  recentRuns: (limit = 20, signal?: AbortSignal) =>
    apiGet<RecentRunsResponse>("/workflows/runs", { query: { limit }, signal }),
  runHistory: (workflowId: string, query: { limit?: number; page?: number }, signal?: AbortSignal) =>
    apiGet<RunListResponse>(`/workflows/${workflowId}/runs`, { query, signal }),
};

// ------------------------------------------------------------------ requirements

export const requirements = {
  /** Analyses and validates a prompt; collects nothing. Needs the AI service, so it can honestly fail. */
  parse: (prompt: string, limits?: PromptLimits) =>
    apiPost<RequirementAnalysis>("/requirements/parse", { prompt, limits }),
};

// ------------------------------------------------------------------ datasets

export const datasets = {
  list: (query: { status?: string; workflowId?: string; limit?: number; page?: number },
         signal?: AbortSignal) =>
    apiGet<DatasetListResponse>("/datasets", { query, signal }),
  details: (id: string, signal?: AbortSignal) =>
    apiGet<DatasetDetails>(`/datasets/${id}`, { signal }),
  schema: (id: string, signal?: AbortSignal) =>
    apiGet<SchemaResponse>(`/datasets/${id}/schema`, { signal }),
  rows: (id: string,
         query: { q?: string; filter?: string[]; sort?: string; asc?: boolean; validOnly?: boolean;
                  includeDuplicates?: boolean; pageSize?: number; page?: number },
         signal?: AbortSignal) =>
    apiGet<RowListResponse>(`/datasets/${id}/rows`, { query, signal }),
  sources: (id: string,
            query: { verified?: boolean; domain?: string; q?: string; pageSize?: number; page?: number },
            signal?: AbortSignal) =>
    apiGet<SourceListResponse>(`/datasets/${id}/sources`, { query, signal }),
  rowEvidence: (id: string, rowId: string, signal?: AbortSignal) =>
    apiGet<RowEvidence>(`/datasets/${id}/rows/${rowId}/evidence`, { signal }),
  evidence: (id: string, signal?: AbortSignal) =>
    apiGet<EvidenceResponse>(`/datasets/${id}/evidence`, { signal }),
};

// ------------------------------------------------------------------ exports

export interface ExportScope {
  format: "csv" | "json" | "xlsx";
  search?: string;
  filters?: string[];
  sort?: string;
  asc?: boolean;
  validOnly?: boolean;
  includeDuplicates?: boolean;
}

export const exportsApi = {
  request: (datasetId: string, body: ExportScope) =>
    apiPost<ExportRequestResponse>(`/datasets/${datasetId}/exports`, body),
  list: (query: { datasetId?: string; limit?: number; page?: number }, signal?: AbortSignal) =>
    apiGet<ExportListResponse>("/exports", { query, signal }),
  get: (id: string, signal?: AbortSignal) =>
    apiGet<{ export: ExportView }>(`/exports/${id}`, { signal }),
  cancel: (id: string) =>
    apiPost<{ export: ExportView; cancelled: boolean }>(`/exports/${id}/cancel`),
  /** A plain href: the response carries `Content-Disposition: attachment` and the cookie rides along. */
  downloadHref: (id: string) => `/api/v1/exports/${id}/download`,
};

// ------------------------------------------------------------------ operations

export const operations = {
  activity: (query: { after?: number; runId?: string; action?: string; limit?: number },
             signal?: AbortSignal) =>
    apiGet<ActivityResponse>("/activity", { query, signal }),
  monitoring: (signal?: AbortSignal) => apiGet<MonitoringResponse>("/monitoring", { signal }),
};
