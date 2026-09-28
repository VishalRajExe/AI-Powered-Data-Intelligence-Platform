import type {
  DatasetRowSource,
  FieldEvidence,
  FieldSourceCitation,
  RowEvidenceExplorerResponse,
} from "./evidence.types.js";

/**
 * Checks whether an evidence snippet actually corroborates or mentions a field value.
 * Does not claim a source verifies a value if the snippet is empty or contains unrelated content.
 */
export function isSnippetVerifyingValue(snippet: string | null | undefined, value: unknown): boolean {
  if (!snippet || snippet.trim().length === 0) return false;
  if (value === null || value === undefined) return false;

  const snippetLower = snippet.toLowerCase();

  // If value is a string or number, check if string representation is included
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const valStr = String(value).trim().toLowerCase();
    if (valStr.length >= 2 && snippetLower.includes(valStr)) {
      return true;
    }

    // For strings with multiple words (e.g., "Acme AI Inc."), check significant word tokens
    if (typeof value === "string") {
      const words = valStr.split(/\s+/).filter((w) => w.length >= 3);
      if (words.length > 0 && words.every((w) => snippetLower.includes(w))) {
        return true;
      }
    }
  }

  // If value is an array, check if any element is mentioned in the snippet
  if (Array.isArray(value)) {
    return value.some((v) => isSnippetVerifyingValue(snippet, v));
  }

  // If value is an object, check if any primitive value is mentioned
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((v) =>
      isSnippetVerifyingValue(snippet, v),
    );
  }

  return false;
}

export interface RawRowForEvidence {
  id: string;
  datasetId: string;
  values: unknown;
  rawValues: unknown;
  confidence: unknown;
  isValid: boolean;
  verificationStatus: string;
  qualityMetadata: unknown;
  duplicateOfId: string | null;
  collectedAt: Date;
  createdAt: Date;
  dataset?: { id: string; workflowRunId: string | null } | null;
  validationIssues?: Array<{
    fieldKey: string | null;
    ruleCode: string;
    severity: string;
    message: string;
  }>;
  sourceEvidence: Array<{
    id: string;
    fieldKey: string | null;
    evidenceType: string;
    snippet: string | null;
    confidence: unknown;
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
      sourceMetadata?: unknown;
    };
    column?: { key: string; label: string; type: string } | null;
  }>;
}

export function buildRowEvidenceExplorer(row: RawRowForEvidence): RowEvidenceExplorerResponse {
  const rowValues = (typeof row.values === "object" && row.values !== null
    ? row.values
    : {}) as Record<string, unknown>;

  const rawValues = (typeof row.rawValues === "object" && row.rawValues !== null
    ? row.rawValues
    : null) as Record<string, unknown> | null;

  const qualityMetadata = (typeof row.qualityMetadata === "object" && row.qualityMetadata !== null
    ? row.qualityMetadata
    : {}) as {
    conflicts?: Array<{
      fieldKey: string;
      canonicalValue: unknown;
      alternateValue: unknown;
      canonicalSourceUrls: string[];
      alternateSourceUrls: string[];
    }>;
  };

  const rawConflicts = Array.isArray(qualityMetadata.conflicts) ? qualityMetadata.conflicts : [];

  // Group evidence by source ID for DatasetRowSource mapping
  const sourceMap = new Map<string, DatasetRowSource>();
  const fieldToSourcesMap = new Map<string, FieldSourceCitation[]>();

  for (const ev of row.sourceEvidence) {
    const src = ev.source;
    const meta = (typeof src.sourceMetadata === "object" && src.sourceMetadata !== null
      ? src.sourceMetadata
      : {}) as Record<string, unknown>;

    const sourceType = String(meta.sourceType ?? ev.evidenceType ?? "scrape");

    // Track in sourceMap (DatasetRowSource)
    if (!sourceMap.has(src.id)) {
      sourceMap.set(src.id, {
        sourceId: src.id,
        url: src.url,
        canonicalUrl: src.canonicalUrl,
        domain: src.domain,
        title: src.title,
        pageTitle: src.title,
        retrievedAt: src.retrievedAt,
        sourceType,
        sourceStatus: src.status,
        supportedFields: [],
        evidenceCount: 0,
      });
    }

    const rowSource = sourceMap.get(src.id)!;
    rowSource.evidenceCount += 1;
    if (ev.fieldKey && !rowSource.supportedFields.includes(ev.fieldKey)) {
      rowSource.supportedFields.push(ev.fieldKey);
    }

    // Build field-level citation
    const fieldKey = ev.fieldKey;
    if (fieldKey) {
      const fieldValue = rowValues[fieldKey];
      const isVerified = isSnippetVerifyingValue(ev.snippet, fieldValue);

      const citation: FieldSourceCitation = {
        sourceId: src.id,
        url: src.url,
        canonicalUrl: src.canonicalUrl,
        domain: src.domain,
        title: src.title,
        pageTitle: src.title,
        retrievedAt: ev.retrievedAt,
        sourceType,
        sourceStatus: src.status,
        evidenceSnippet: ev.snippet,
        confidence: typeof ev.confidence === "number" ? ev.confidence : ev.confidence ? Number(ev.confidence) : null,
        isVerified,
      };

      if (!fieldToSourcesMap.has(fieldKey)) {
        fieldToSourcesMap.set(fieldKey, []);
      }
      fieldToSourcesMap.get(fieldKey)!.push(citation);
    }
  }

  // Construct field-by-field provenance map (FieldEvidence)
  const fields: Record<string, FieldEvidence> = {};

  for (const [key, value] of Object.entries(rowValues)) {
    let citations = fieldToSourcesMap.get(key) ?? [];

    // If no field-specific evidence was recorded, check if row-level evidence verifies the field
    if (citations.length === 0) {
      citations = row.sourceEvidence.map((ev) => {
        const src = ev.source;
        const meta = (typeof src.sourceMetadata === "object" && src.sourceMetadata !== null
          ? src.sourceMetadata
          : {}) as Record<string, unknown>;
        const isVerified = isSnippetVerifyingValue(ev.snippet, value);
        return {
          sourceId: src.id,
          url: src.url,
          canonicalUrl: src.canonicalUrl,
          domain: src.domain,
          title: src.title,
          pageTitle: src.title,
          retrievedAt: ev.retrievedAt,
          sourceType: String(meta.sourceType ?? ev.evidenceType ?? "scrape"),
          sourceStatus: src.status,
          evidenceSnippet: ev.snippet,
          confidence: typeof ev.confidence === "number" ? ev.confidence : ev.confidence ? Number(ev.confidence) : null,
          isVerified,
        };
      });
    }

    const fieldConflicts = rawConflicts
      .filter((c) => c.fieldKey === key)
      .map((c) => ({
        alternateValue: c.alternateValue,
        canonicalSourceUrls: c.canonicalSourceUrls,
        alternateSourceUrls: c.alternateSourceUrls,
      }));

    fields[key] = {
      fieldKey: key,
      value,
      sources: citations,
      isVerified: citations.some((c) => c.isVerified),
      hasConflict: fieldConflicts.length > 0,
      conflicts: fieldConflicts,
    };
  }

  return {
    rowId: row.id,
    datasetId: row.datasetId,
    workflowRunId: row.dataset?.workflowRunId ?? null,
    values: rowValues,
    rawValues,
    confidence: typeof row.confidence === "number" ? row.confidence : row.confidence ? Number(row.confidence) : null,
    isValid: row.isValid,
    verificationStatus: row.verificationStatus,
    collectedAt: row.collectedAt,
    createdAt: row.createdAt,
    sources: Array.from(sourceMap.values()),
    fields,
    conflicts: rawConflicts,
    validationIssues: (row.validationIssues ?? []).map((issue) => ({
      fieldKey: issue.fieldKey,
      ruleCode: issue.ruleCode,
      severity: issue.severity,
      message: issue.message,
    })),
    evidence: row.sourceEvidence.map((ev) => ({
      id: ev.id,
      fieldKey: ev.fieldKey,
      evidenceType: ev.evidenceType,
      snippet: ev.snippet,
      confidence: typeof ev.confidence === "number" ? ev.confidence : ev.confidence ? Number(ev.confidence) : null,
      retrievedAt: ev.retrievedAt,
      source: {
        id: ev.source.id,
        url: ev.source.url,
        canonicalUrl: ev.source.canonicalUrl,
        domain: ev.source.domain,
        title: ev.source.title,
        status: ev.source.status,
        policyReason: ev.source.policyReason,
        robotsStatus: ev.source.robotsStatus,
        attemptCount: ev.source.attemptCount,
        retrievedAt: ev.source.retrievedAt,
      },
    })),
  };
}
