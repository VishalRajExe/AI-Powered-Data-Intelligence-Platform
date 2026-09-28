/**
 * Phase 10 — Source and Evidence Explorer Domain Models
 *
 * Types representing source provenance, field-level evidence,
 * row-level source mappings, and conflict preservation.
 */

export interface SourceDetail {
  id: string;
  url: string;
  canonicalUrl: string;
  domain: string;
  title: string | null;
  pageTitle: string | null;
  status: string;
  sourceStatus: string;
  sourceType: string;
  workflowRunId: string;
  extractionStep: string;
  policyReason: string | null;
  robotsStatus: string | null;
  attemptCount: number;
  lastAttemptAt: Date | null;
  retrievedAt: Date | null;
  evidenceSnippet: string | null;
  evidenceCount: number;
}

/**
 * DatasetRowSource represents a distinct source that contributed
 * to a dataset row, tracking which specific fields it supported.
 */
export interface DatasetRowSource {
  sourceId: string;
  url: string;
  canonicalUrl: string;
  domain: string;
  title: string | null;
  pageTitle: string | null;
  retrievedAt: Date | null;
  sourceType: string;
  sourceStatus: string;
  supportedFields: string[];
  evidenceCount: number;
}

/**
 * FieldSourceCitation represents a single source citation supporting a specific field.
 */
export interface FieldSourceCitation {
  sourceId: string;
  url: string;
  canonicalUrl: string;
  domain: string;
  title: string | null;
  pageTitle: string | null;
  retrievedAt: Date | null;
  sourceType: string;
  sourceStatus: string;
  evidenceSnippet: string | null;
  confidence: number | null;
  /**
   * Verified is true ONLY if the evidence snippet actually contains or directly
   * corroborates the field value. Unrelated content is explicitly flagged as unverified.
   */
  isVerified: boolean;
}

/**
 * FieldEvidence represents field-level provenance for a single field in a row.
 * Shows which source(s) produced or corroborated this specific field, and
 * preserves any conflicting values observed across different sources.
 */
export interface FieldEvidence {
  fieldKey: string;
  value: unknown;
  sources: FieldSourceCitation[];
  isVerified: boolean;
  hasConflict: boolean;
  conflicts: Array<{
    alternateValue: unknown;
    canonicalSourceUrls: string[];
    alternateSourceUrls: string[];
  }>;
}

/**
 * Full response structure for GET /api/v1/rows/:id/evidence
 */
export interface RowEvidenceExplorerResponse {
  rowId: string;
  datasetId: string;
  workflowRunId: string | null;
  values: Record<string, unknown>;
  rawValues: Record<string, unknown> | null;
  confidence: number | null;
  isValid: boolean;
  verificationStatus: string;
  collectedAt: Date;
  createdAt: Date;
  /**
   * Unique sources backing this row (DatasetRowSource model).
   */
  sources: DatasetRowSource[];
  /**
   * Field-by-field provenance map (FieldEvidence model).
   * Maps each fieldKey -> supporting sources, snippets, verification status, and conflicts.
   */
  fields: Record<string, FieldEvidence>;
  /**
   * Preserved conflicts where different sources disagreed on field values.
   */
  conflicts: Array<{
    fieldKey: string;
    canonicalValue: unknown;
    alternateValue: unknown;
    canonicalSourceUrls: string[];
    alternateSourceUrls: string[];
  }>;
  validationIssues: Array<{
    fieldKey: string | null;
    ruleCode: string;
    severity: string;
    message: string;
  }>;
  evidence: Array<{
    id: string;
    fieldKey: string | null;
    evidenceType: string;
    snippet: string | null;
    confidence: number | null;
    retrievedAt: Date;
    source: {
      id: string;
      url: string;
      canonicalUrl: string;
      domain: string;
      title: string | null;
      status: string;
      policyReason: string | null;
      robotsStatus: string | null;
      attemptCount: number;
      retrievedAt: Date | null;
    };
  }>;
}
