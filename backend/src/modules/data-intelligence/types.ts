export type VerificationState = "SOURCE_CITED_UNVERIFIED" | "UNSUPPORTED" | "CONFLICTED";

export type DuplicateDecision = "LINKED" | "MERGED" | "KEPT_SEPARATE" | "REVIEW_REQUIRED";

export type MatchType = "EXACT" | "NORMALIZED" | "URL" | "LIKELY_ENTITY";

export interface FieldQuality {
  confidence: number;
  verificationState: VerificationState;
  normalizationNotes: string[];
}

export interface RecordConflict {
  fieldKey: string;
  canonicalValue: unknown;
  alternateValue: unknown;
  canonicalSourceUrls: string[];
  alternateSourceUrls: string[];
}

export interface DuplicateMetadata {
  decision: DuplicateDecision;
  matchType: MatchType;
  confidence: number;
  matchedFields: string[];
  reason: string;
}

export interface RecordQualityMetadata {
  confidence: number;
  verificationState: VerificationState;
  evidenceScope: "RECORD_LEVEL";
  fields: Record<string, FieldQuality>;
  conflicts: RecordConflict[];
  duplicate?: DuplicateMetadata;
  duplicateOfIndex?: number;
  warnings: string[];
}

export interface DeduplicationEventRecord {
  canonicalIndex: number;
  duplicateIndex: number;
  decision: DuplicateDecision;
  matchType: MatchType;
  confidence: number;
  matchedFields: string[];
  reason: string;
}

export interface DataQualityMetrics {
  rawRecordCount: number;
  normalizedRecordCount: number;
  sourceBackedRecordCount: number;
  unsupportedRecordCount: number;
  validRecordCount: number;
  invalidRecordCount: number;
  duplicateCount: number;
  reviewRequiredCount: number;
  conflictCount: number;
  validationErrorCount: number;
  validationWarningCount: number;
  meanConfidence: number;
  qualityScore: number;
}

export interface DataQualityAssessment {
  version: 1;
  computedAt: string;
  metrics: DataQualityMetrics;
  deduplicationEvents: DeduplicationEventRecord[];
}
