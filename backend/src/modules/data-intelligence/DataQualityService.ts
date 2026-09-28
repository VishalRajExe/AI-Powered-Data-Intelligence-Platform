import type { AgentResult } from "../../agent/types.js";
import type { WorkflowPlan } from "../planner/workflow-plan.schema.js";
import { DeduplicationService } from "./DeduplicationService.js";
import { EntityResolutionService } from "./EntityResolutionService.js";
import { NormalizationService } from "./NormalizationService.js";
import { ValidationService } from "./ValidationService.js";
import type { DataQualityAssessment, DataQualityMetrics, DeduplicationEventRecord } from "./types.js";

export class DataQualityService {
  constructor(
    private readonly normalizer = new NormalizationService(),
    private readonly validator = new ValidationService(),
    private readonly deduplicator = new DeduplicationService(),
    private readonly entityResolver = new EntityResolutionService(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  normalize(result: AgentResult, plan: WorkflowPlan): AgentResult {
    return this.normalizer.normalize(result, plan);
  }

  validate(result: AgentResult, plan: WorkflowPlan): { result: AgentResult; issueCount: number; invalidRecordCount: number } {
    const validation = this.validator.validate(result, plan);
    return { result: validation.result, issueCount: validation.summary.issueCount, invalidRecordCount: validation.summary.invalidRecordCount };
  }

  deduplicate(result: AgentResult, plan: WorkflowPlan) {
    return this.deduplicator.deduplicate(result, plan);
  }

  resolveEntities(result: AgentResult, plan: WorkflowPlan) {
    return this.entityResolver.resolve(result, plan);
  }

  process(result: AgentResult, plan: WorkflowPlan): AgentResult {
    const rawRecordCount = result.dataQuality?.metrics.rawRecordCount ?? result.records.length;
    let current = this.normalize(result, plan);
    current = this.validate(current, plan).result;
    const deduplicated = this.deduplicate(current, plan);
    current = deduplicated.result;
    const resolved = this.resolveEntities(current, plan);
    current = resolved.result;
    const events = [...deduplicated.events, ...resolved.events];
    const assessment = this.assess(current, plan, rawRecordCount, events, deduplicated.duplicateCount + resolved.mergedCount);
    return { ...current, dataQuality: assessment };
  }

  private assess(result: AgentResult, plan: WorkflowPlan, rawRecordCount: number, events: DeduplicationEventRecord[], duplicateCount: number): DataQualityAssessment {
    const records = result.records;
    let validationErrorCount = 0;
    let validationWarningCount = 0;
    let sourceBackedRecordCount = 0;
    let unsupportedRecordCount = 0;
    let validRecordCount = 0;
    let invalidRecordCount = 0;
    let validRawRecordCount = 0;
    let conflictCount = 0;

    for (const record of records) {
      const sourceBacked = record.sourceUrls.length > 0;
      if (sourceBacked) sourceBackedRecordCount += 1;
      else unsupportedRecordCount += 1;
      const issues = record.validationIssues ?? [];
      const errors = issues.filter(({ severity }) => severity === "ERROR").length;
      const warnings = issues.filter(({ severity }) => severity === "WARNING").length;
      validationErrorCount += errors;
      validationWarningCount += warnings;
      if (record.isValid === false) invalidRecordCount += 1;
      else validRawRecordCount += 1;
      if (record.isValid !== false && record.quality?.duplicateOfIndex === undefined) validRecordCount += 1;
      conflictCount += record.quality?.conflicts.length ?? 0;

      const requiredFields = plan.requirement.requiredFields.length ? plan.requirement.requiredFields : plan.extractionSchema.required;
      const populatedRequired = requiredFields.filter((key) => !isMissing(record.values[key])).length;
      const completeness = requiredFields.length ? populatedRequired / requiredFields.length : 1;
      const sourceDomainCount = new Set(record.sourceUrls.map(sourceDomain).filter(Boolean)).size;
      const confidence = sourceBacked
        ? clamp(0.2 + 0.15 + Math.min(0.2, Math.max(0, sourceDomainCount - 1) * 0.1) + completeness * 0.25 + (errors ? 0 : 0.15) - Math.min(0.2, warnings * 0.025) - Math.min(0.25, (record.quality?.conflicts.length ?? 0) * 0.1), 0.05, 0.95)
        : 0.05;
      const verificationState = record.quality?.conflicts.length ? "CONFLICTED" as const : sourceBacked ? "SOURCE_CITED_UNVERIFIED" as const : "UNSUPPORTED" as const;
      record.quality ??= { confidence, verificationState, evidenceScope: "RECORD_LEVEL", fields: {}, conflicts: [], warnings: [] };
      record.quality.confidence = confidence;
      record.quality.verificationState = verificationState;
      record.quality.evidenceScope = "RECORD_LEVEL";
      record.quality.fields = Object.fromEntries(Object.keys(plan.extractionSchema.properties).map((fieldKey) => {
        const existing = record.quality!.fields[fieldKey];
        const state = isMissing(record.values[fieldKey]) ? "UNSUPPORTED" as const
          : record.quality!.conflicts.some((conflict) => conflict.fieldKey === fieldKey) ? "CONFLICTED" as const
            : sourceBacked ? "SOURCE_CITED_UNVERIFIED" as const : "UNSUPPORTED" as const;
        return [fieldKey, {
          confidence: isMissing(record.values[fieldKey]) ? 0 : sourceBacked ? Math.min(0.7, confidence) : 0.05,
          verificationState: state,
          normalizationNotes: existing?.normalizationNotes ?? [],
        }];
      }));
    }

    const canonical = records.filter(({ quality }) => quality?.duplicateOfIndex === undefined);
    const meanConfidence = average(canonical.map(({ quality }) => quality?.confidence ?? 0));
    const qualityScore = clamp(meanConfidence, 0, 1);
    const metrics: DataQualityMetrics = {
      rawRecordCount,
      normalizedRecordCount: records.length,
      sourceBackedRecordCount,
      unsupportedRecordCount,
      validRecordCount,
      invalidRecordCount: Math.max(invalidRecordCount, records.length - validRawRecordCount),
      duplicateCount,
      reviewRequiredCount: events.filter(({ decision }) => decision === "REVIEW_REQUIRED").length,
      conflictCount,
      validationErrorCount,
      validationWarningCount,
      meanConfidence: round(meanConfidence),
      qualityScore: round(qualityScore),
    };
    return { version: 1, computedAt: this.clock().toISOString(), metrics, deduplicationEvents: events };
  }
}

function sourceDomain(value: string): string | undefined {
  try { return new URL(value).hostname.toLocaleLowerCase(); } catch { return undefined; }
}
function isMissing(value: unknown): boolean { return value === null || value === undefined || (typeof value === "string" && value.trim() === ""); }
function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function average(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function round(value: number): number { return Math.round(value * 10_000) / 10_000; }
