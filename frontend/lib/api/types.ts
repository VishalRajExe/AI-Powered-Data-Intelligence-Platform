/**
 * Typed envelopes for every backend endpoint the dashboard consumes.
 *
 * Each shape mirrors a Java controller's `Map`/record output, field for field. Where the backend
 * omits a key, it is because `application.yml` sets `default-property-inclusion: non_null`, so
 * those fields are optional here rather than nullable — a missing key and a null key are the same
 * event to a reader, and neither is ever filled in with a guessed value.
 */

export type ComponentStatus = "UP" | "DOWN";

/** `GET /api/v1/health` — liveness. */
export interface HealthResponse {
  status: string;
  application: string;
  profile: string;
  version?: string;
  timestamp: string;
}

/** One dependency entry inside the readiness report. */
export interface ReadinessComponent {
  status: ComponentStatus;
  /** Backend-supplied free-form detail (e.g. `{ database: "finalagent_dev" }`). Never synthesized. */
  details?: Record<string, string | number | boolean | null>;
}

/** The dependency map inside the readiness report. */
export interface ReadinessComponents {
  mysql?: ReadinessComponent;
  aiService?: ReadinessComponent;
  credentials?: ReadinessComponent;
  workflowQueue?: ReadinessComponent;
}

/**
 * `GET /api/v1/ready` — HTTP 200 when every check passes, 503 otherwise.
 * Both codes carry this same envelope, so the UI must read `status`/`components`, not the code.
 */
export interface ReadinessResponse {
  status: ComponentStatus;
  components?: ReadinessComponents;
  timestamp: string;
}

/** The body of the single error envelope every backend failure writes. */
export interface ErrorBody {
  code: string;
  message: string;
  details?: unknown[];
}

/** Spring's error shape: `{ "error": { "code", "message", "details" } }`. */
export interface ErrorEnvelope {
  error?: ErrorBody;
}

/** Pagination metadata shared by the list endpoints (offset pages, `page` is 0-based). */
export interface PageMeta {
  total: number;
  page: number;
  pageSize: number;
}

// ------------------------------------------------------------------ identity

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  status: string;
  lastLoginAt?: string;
}

export interface AuthWorkspace {
  id?: string;
  name?: string;
  kind?: string;
  /** OWNER | EDITOR | VIEWER, from `Identity.WorkspaceRole`. */
  role: string;
  canWrite: boolean;
  isOwner: boolean;
}

export interface AuthSession {
  accessTokenTtlMinutes: number;
  refreshTtlDays: number;
}

/** `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`. */
export interface WhoResponse {
  user: AuthUser;
  workspace: AuthWorkspace;
  session: AuthSession;
  /** Only on `/auth/me`: the session the presented credential opened. */
  sessionId?: string;
}

// ------------------------------------------------------------------ workflows

export interface WorkflowSummary {
  id: string;
  name: string;
  /** DRAFT | ACTIVE | PAUSED | ARCHIVED. */
  status: string;
  /** NOT_STARTED | PLANNING | PLANNED | FAILED. */
  planningStatus: string;
  requirementText: string;
  runCount?: number;
  latestPlanVersion?: number;
  createdAt: string;
  updatedAt?: string;
}

/** `GET /api/v1/workflows` (the operations read model). */
export interface WorkflowListResponse extends PageMeta {
  workflows: WorkflowSummary[];
}

export interface WorkflowCreateResponse {
  workflow: WorkflowSummary;
  next: string;
}

export interface RunView {
  id: string;
  workflowId: string;
  planId?: string;
  /** PENDING | PLANNING | RUNNING | COMPLETED | PARTIAL | FAILED | CANCELLED. */
  status: string;
  attempt: number;
  progress: number;
  recordsRaw?: number;
  recordsFound?: number;
  recordsValid?: number;
  duplicateCount?: number;
  sourcesProcessed?: number;
  sourcesFailed?: number;
  errorCode?: string;
  errorMessage?: string;
  cancelRequested: boolean;
  startedAt?: string;
  finishedAt?: string;
  createdAt?: string;
}

export interface JobView {
  id: string;
  jobType?: string;
  stepId?: string;
  status: string;
  priority?: number;
  attemptCount?: number;
  maxAttempts?: number;
  workerId?: string;
  lockedAt?: string;
  leaseExpiresAt?: string;
  scheduledFor?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface StepView {
  id: string;
  stepKey: string;
  sequence: number;
  type: string;
  status: string;
  attempt: number;
  retryCount?: number;
  dependsOn?: string[];
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  outputSummary?: Record<string, unknown>;
  job?: JobView | null;
}

/** `GET /api/v1/workflows/{id}/plan` — `steps` is the plan's stored JSON document, as a string. */
export interface PlanView {
  id: string;
  workflowId: string;
  version: number;
  objective: string;
  planHash: string;
  steps: string;
  sourcePolicy?: string;
  completionCriteria?: string;
}

export interface PlanStep {
  key: string;
  type: string;
  dependsOn: string[];
  config: Record<string, unknown>;
}

export interface PlanResponse {
  workflow: WorkflowSummary;
  plan: PlanView;
  warning: string;
}

export interface RunDetailResponse {
  run: RunView;
  steps: StepView[];
  jobs: JobView[];
}

/** `GET /api/v1/workflows/runs` — recent runs across the workspace plus the worker's own state. */
export interface RecentRunsResponse {
  runs: RunView[];
  worker: { id: string; running: boolean; inFlight: number; freeSlots: number };
}

export interface RunListResponse extends PageMeta {
  workflowId: string;
  runs: RunView[];
}

// ------------------------------------------------------------------ requirements

export interface RequirementField {
  key: string;
  label?: string;
  type?: string;
  description?: string;
}

export interface RequirementFilter {
  field: string;
  operator: string;
  value?: string;
}

export interface Requirement {
  objective?: string;
  entityType?: string;
  quantity?: number;
  geography?: { places?: string[]; scope?: string; includeSubregions?: boolean };
  timeRange?: { from?: string; to?: string; relative?: string };
  filters?: RequirementFilter[];
  constraints?: string[];
  fields?: RequirementField[];
  requiredFields?: string[];
  optionalFields?: string[];
  sourcePreferences?: string[];
  sourceRestrictions?: string[];
  deduplicationKeys?: string[];
  outputFormat?: string;
  ambiguities?: string[];
  missingInformation?: string[];
  warnings?: string[];
}

/** `POST /api/v1/requirements/parse`. */
export interface RequirementAnalysis {
  status: string;
  requirement?: Requirement;
  extractionSchema?: Record<string, unknown>;
  searchQueries?: string[];
  researchBrief?: string;
  collectionPolicy?: Record<string, unknown>;
  clarificationQuestions?: string[];
  metadata?: Record<string, unknown>;
}

// ------------------------------------------------------------------ datasets

export interface DatasetSummary {
  id: string;
  runId?: string;
  workflowId?: string;
  planId?: string;
  stepId?: string;
  objective?: string;
  entityType?: string;
  status: string;
  rowCount: number;
  validRowCount?: number;
  invalidRowCount?: number;
  duplicateCount?: number;
  conflictCount?: number;
  sourceCount: number;
  verifiedSourceCount?: number;
  unverifiedSourceCount?: number;
  blockedSourceCount?: number;
  recordsWithoutEvidence?: number;
  qualityScore?: number;
  qualityBasis?: string;
  createdAt: string;
  updatedAt?: string;
}

/** `GET /api/v1/datasets`. */
export interface DatasetListResponse extends PageMeta {
  datasets: DatasetSummary[];
}

export interface DatasetDetails extends DatasetSummary {
  extractionSchema?: Record<string, unknown>;
  quality?: Record<string, unknown>;
  error?: { code: string; message: string } | null;
}

export interface DatasetColumn {
  key: string;
  label?: string;
  type?: string;
  required?: boolean;
  position?: number;
  /** PLAN | EXTRACTION_SCHEMA | PIPELINE | DATA — which stage declared this column. */
  origin?: string;
  populatedCount?: number;
}

export interface SchemaResponse {
  datasetId: string;
  entityType?: string;
  columnCount: number;
  columns: DatasetColumn[];
  note: string;
}

export interface DataRow {
  id: string;
  datasetId: string;
  recordIndex: number;
  values: Record<string, unknown>;
  rawValues?: Record<string, unknown>;
  valid: boolean;
  advisoryValid?: boolean;
  verificationStatus?: string;
  confidence?: number;
  duplicateOf?: string | null;
  matchType?: string;
  reviewRequired?: boolean;
  conflictCount?: number;
  sourceCount?: number;
  verifiedSourceCount?: number;
  evidencedFieldCount?: number;
  populatedFieldCount?: number;
  runId?: string;
  stepId?: string;
  matchedFields?: string[];
}

export interface RowListResponse {
  datasetId: string;
  rows: DataRow[];
  matchedRows: number;
  page: number;
  pageSize: number;
  appliedFilters?: { key: string; operator: string; value?: string }[];
  sortedBy?: { key: string; direction: "asc" | "desc" };
  term?: string;
}

export interface DatasetSource {
  id: string;
  url: string;
  domain?: string;
  title?: string;
  snippet?: string;
  sourceType?: string;
  retrievedAt?: string;
  verifiedByTool: boolean;
  provenance?: string;
  blockedCode?: string;
  blockedReason?: string;
  citationCount?: number;
  citedByRows?: number;
}

export interface SourceListResponse {
  datasetId: string;
  total: number;
  page: number;
  pageSize: number;
  sources: DatasetSource[];
  counts: { all: number; verifiedByTool: number; modelCitedOnly: number; blockedBeforeFetch: number };
}

/** One column's coverage, as `DatasetQueryRepository.coverage` measures it. */
export interface CoverageRow {
  key: string;
  type?: string;
  rowsWithValue: number;
  rowsAttributed: number;
}

/** `GET /api/v1/datasets/{id}/evidence`. */
export interface EvidenceResponse {
  datasetId: string;
  rowCount: number;
  recordsWithoutEvidence?: number;
  coverage: CoverageRow[];
  rowsWithoutEvidence: { id: string; recordIndex: number }[];
  citedButNeverRetrieved: { id: string; url: string; citedByRows?: number }[];
  truncation: { rowsWithoutEvidence: boolean; citedButNeverRetrieved: boolean };
}

/** `GET /api/v1/datasets/{id}/rows/{rowId}/evidence`. */
export interface RowEvidenceField {
  key: string;
  value: unknown;
  attributed: boolean;
  attributedSources: { sourceId?: string; url?: string; [key: string]: unknown }[];
  rowLevelSources: { id?: string; url?: string; domain?: string; [key: string]: unknown }[];
}

export interface RowEvidence {
  datasetId: string;
  rowId: string;
  recordIndex: number;
  runId?: string;
  stepId?: string;
  valid: boolean;
  advisoryValid?: boolean;
  verificationStatus?: string;
  confidence?: number;
  duplicateOf?: string;
  matchType?: string;
  reviewRequired?: boolean;
  evidencedFieldCount?: number;
  populatedFieldCount?: number;
  fields: RowEvidenceField[];
  conflicts: {
    columnKey: string;
    keptValue?: unknown;
    rejectedValue?: unknown;
    keptSources?: unknown;
    rejectedSources?: unknown;
    resolvedBy?: string;
  }[];
  issues?: unknown;
  normalizationNotes?: unknown;
}

// ------------------------------------------------------------------ exports

export interface ExportView {
  id: string;
  datasetId: string;
  runId?: string;
  jobId?: string;
  format: string;
  status: string;
  totalRows?: number;
  writtenRows?: number;
  progressPercent?: number;
  fileName?: string;
  checksum?: string;
  fileSizeBytes?: number;
  errorCode?: string;
  errorMessage?: string;
  createdAt?: string;
  finishedAt?: string;
}

export interface ExportRequestResponse {
  export: ExportView;
  statusUrl: string;
  downloadUrl: string;
  note: string;
}

export interface ExportListResponse extends PageMeta {
  exports: ExportView[];
}

// ------------------------------------------------------------------ operations

/** An activity row: `ActivityRepository.feed` returns the column names as SQL sees them. */
export interface ActivityEvent {
  id: number;
  run_id?: string;
  actor_id?: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  message?: string;
  created_at: string;
}

export interface ActivityResponse {
  events: ActivityEvent[];
  after: number;
  nextCursor: number;
  more: boolean;
  truncated: boolean;
}

/** `GET /api/v1/monitoring`. */
export interface MonitoringResponse {
  workspaceId: string;
  workflows: { total: number };
  runs: {
    byStatus: Record<string, number>;
    active: number;
    totals: {
      recordsRaw: number;
      recordsFound: number;
      recordsValid: number;
      duplicates: number;
      sourcesProcessed: number;
      sourcesFailed: number;
    };
  };
  queue: {
    pending: number;
    running: number;
    byTypeAndStatus?: { job_type?: string; status?: string; n?: number }[];
    scope: string;
  };
  worker: {
    id: string;
    enabled: boolean;
    running: boolean;
    inFlight: number;
    freeSlots: number;
    leaseSeconds?: number;
    pollIntervalMs?: number;
  };
  datasets: {
    total: number;
    rows: { rows: number; validRows: number; sources: number; verifiedSources: number };
  };
  exports: Record<string, number>;
  recentActivity: ActivityEvent[];
}

export interface StepHistoryResponse {
  runId: string;
  runStatus: string;
  progress: number;
  steps: StepView[];
  events: ActivityEvent[];
}
