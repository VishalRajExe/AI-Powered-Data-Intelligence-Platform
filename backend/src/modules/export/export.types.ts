export type ExportFormat = "CSV" | "JSON" | "XLSX";

export type ExportJobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "EXPIRED";

export interface ExportFilterDefinition {
  columns?: string[] | undefined;
  search?: string | undefined;
  validOnly?: boolean | undefined;
  duplicatesOnly?: boolean | undefined;
  verificationStatus?: "SOURCE_CITED_UNVERIFIED" | "UNSUPPORTED" | "CONFLICTED" | undefined;
  confidenceMin?: number | undefined;
  confidenceMax?: number | undefined;
  sourceId?: string | undefined;
  fieldFilters?: Record<string, string | number | boolean> | undefined;
  sort?: {
    field?: "createdAt" | "confidence" | "collectedAt" | undefined;
    order?: "asc" | "desc" | undefined;
  } | undefined;
}

export interface ExportFileMetadata {
  fileName: string;
  fileSize: number;
  rowCount: number;
  columnCount: number;
  contentType: string;
  checksumSha256?: string | undefined;
  downloadUrl?: string | undefined;
}

export interface ExportJobView {
  id: string;
  datasetId: string;
  format: ExportFormat;
  filterDefinition: ExportFilterDefinition | null;
  status: ExportJobStatus;
  createdAt: string;
  completedAt: string | null;
  error: { code: string; message: string } | string | null;
  fileMetadata: ExportFileMetadata | null;
  downloadUrl?: string | undefined;
}

export interface CreateExportInput {
  workspaceId: string;
  userId: string;
  datasetId: string;
  format: ExportFormat;
  filterDefinition?: ExportFilterDefinition | undefined;
}

export interface DatasetColumnSummary {
  key: string;
  label: string;
  type: string;
  position: number;
}
