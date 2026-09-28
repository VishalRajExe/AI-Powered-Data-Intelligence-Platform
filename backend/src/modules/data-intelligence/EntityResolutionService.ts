import type { AgentResult } from "../../agent/types.js";
import type { WorkflowPlan } from "../planner/workflow-plan.schema.js";
import { mergeIntoCanonical, normalizeText } from "./recordMerge.js";
import type { DeduplicationEventRecord } from "./types.js";

export interface EntityResolutionSummary {
  result: AgentResult;
  events: DeduplicationEventRecord[];
  mergedCount: number;
  reviewRequiredCount: number;
  conflictCount: number;
}

const LEGAL_SUFFIXES = /\b(incorporated|inc|limited|ltd|llc|llp|corp|corporation|company|co|plc|private|pvt)\b/giu;
const NAME_FIELD = /(^|_)(company|organization|organisation|entity|person|event|product)?_?name$|^name$/iu;

export class EntityResolutionService {
  resolve(result: AgentResult, plan: WorkflowPlan): EntityResolutionSummary {
    const records = result.records;
    const nameField = Object.keys(plan.extractionSchema.properties).find((key) => NAME_FIELD.test(key));
    if (!nameField) return { result, events: [], mergedCount: 0, reviewRequiredCount: 0, conflictCount: 0 };

    const fuzzyRule = plan.deduplicationRules.find(({ strategy }) => strategy === "FUZZY_REVIEW");
    const threshold = fuzzyRule?.confidenceThreshold ?? 0.94;
    const candidatesByBlock = new Map<string, number[]>();
    const events: DeduplicationEventRecord[] = [];
    let mergedCount = 0;
    let reviewRequiredCount = 0;
    let conflictCount = 0;

    for (const [index, record] of records.entries()) {
      if (record.quality?.duplicateOfIndex !== undefined) continue;
      const normalizedName = normalizeEntityName(record.values[nameField]);
      if (!normalizedName) continue;
      const blocks = blockingKeys(normalizedName, record.values);
      const candidates = new Set(blocks.flatMap((block) => candidatesByBlock.get(block) ?? []));
      let selected: { otherIndex: number; confidence: number; sharedIdentifier: boolean } | undefined;

      for (const otherIndex of candidates) {
        const other = records[otherIndex]!;
        if (other.quality?.duplicateOfIndex !== undefined) continue;
        const otherName = normalizeEntityName(other.values[nameField]);
        if (!otherName) continue;
        const confidence = similarity(normalizedName, otherName);
        if (confidence < threshold) continue;
        const sharedIdentifier = hasSharedIdentifier(record.values, other.values, plan);
        if (!selected || (sharedIdentifier && !selected.sharedIdentifier) || confidence > selected.confidence) {
          selected = { otherIndex, confidence, sharedIdentifier };
        }
      }

      if (selected) {
        const other = records[selected.otherIndex]!;
        const decision = selected.sharedIdentifier
          ? "MERGED" as const
          : fuzzyRule?.ambiguousMatchAction === "KEEP_SEPARATE" ? "KEPT_SEPARATE" as const : "REVIEW_REQUIRED" as const;
        const matchedFields = [nameField, ...(fuzzyRule?.keys.filter((key) => key !== nameField) ?? [])];
        let reason: string;
        if (selected.sharedIdentifier) {
          const conflicts = mergeIntoCanonical(other, record);
          conflictCount += conflicts.length;
          record.quality ??= emptyQuality();
          record.quality.duplicateOfIndex = selected.otherIndex;
          record.quality.duplicate = { decision, matchType: "LIKELY_ENTITY", confidence: selected.confidence, matchedFields, reason: "Similar names and a shared stable identifier support linking these records." };
          other.quality ??= emptyQuality();
          other.quality.duplicate = { decision: "LINKED", matchType: "LIKELY_ENTITY", confidence: selected.confidence, matchedFields, reason: "Canonical entity row; the alternate source record is retained and linked." };
          mergedCount += 1;
          reason = conflicts.length ? "Linked by name and stable identifier; " + conflicts.length + " conflicting field value(s) were kept for review." : "Linked by similar normalized name and a shared stable identifier.";
        } else {
          reason = "Names are similar, but no shared stable identifier supports an automatic merge; records were kept separate.";
          record.quality ??= emptyQuality();
          record.quality.duplicate = { decision, matchType: "LIKELY_ENTITY", confidence: selected.confidence, matchedFields: [nameField], reason };
          other.quality ??= emptyQuality();
        }
        if (decision === "REVIEW_REQUIRED") reviewRequiredCount += 1;
        events.push({ canonicalIndex: selected.otherIndex, duplicateIndex: index, decision, matchType: "LIKELY_ENTITY", confidence: selected.confidence, matchedFields, reason });
      }
      for (const block of blocks) {
        const indexes = candidatesByBlock.get(block) ?? [];
        indexes.push(index);
        candidatesByBlock.set(block, indexes);
      }
    }
    return { result: { ...result, records }, events, mergedCount, reviewRequiredCount, conflictCount };
  }
}

function normalizeEntityName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = normalizeText(value).replace(LEGAL_SUFFIXES, "").replace(/\s+/gu, "").trim();
  return normalized.length >= 2 ? normalized : undefined;
}

function blockingKeys(name: string, values: Record<string, unknown>): string[] {
  const keys = new Set<string>(["name:" + name.slice(0, 2)]);
  for (const [field, value] of Object.entries(values)) {
    if (typeof value !== "string" || !/(website|url|domain|linkedin|email|registration|tax)/iu.test(field)) continue;
    const normalized = normalizeIdentifier(field, value);
    if (normalized) keys.add("id:" + field + ":" + normalized);
  }
  return [...keys];
}

function hasSharedIdentifier(left: Record<string, unknown>, right: Record<string, unknown>, plan: WorkflowPlan): boolean {
  const declared = new Set(plan.deduplicationRules.flatMap(({ keys }) => keys));
  for (const [field, value] of Object.entries(left)) {
    if (!declared.has(field) && !/(website|url|domain|linkedin|email|registration|tax)/iu.test(field)) continue;
    const rightValue = right[field];
    if (typeof value !== "string" || typeof rightValue !== "string") continue;
    const normalizedLeft = normalizeIdentifier(field, value);
    if (normalizedLeft && normalizedLeft === normalizeIdentifier(field, rightValue)) return true;
  }
  return false;
}

function normalizeIdentifier(field: string, value: string): string | undefined {
  if (/(url|website|domain|linkedin)/iu.test(field)) {
    try {
      const url = new URL(/^[a-z][a-z\d+.-]*:\/\//iu.test(value) ? value : "https://" + value);
      return url.hostname.toLocaleLowerCase().replace(/^www\./u, "");
    } catch { return undefined; }
  }
  const normalized = normalizeText(value).replace(/\s+/gu, "");
  return normalized || undefined;
}

function similarity(left: string, right: string): number {
  if (left === right) return 1;
  return 1 - levenshtein(left, right) / Math.max(left.length, right.length, 1);
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0]!;
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const old = previous[rightIndex]!;
      previous[rightIndex] = Math.min(previous[rightIndex]! + 1, previous[rightIndex - 1]! + 1, diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1));
      diagonal = old;
    }
  }
  return previous[right.length]!;
}

function emptyQuality() {
  return { confidence: 0, verificationState: "UNSUPPORTED" as const, evidenceScope: "RECORD_LEVEL" as const, fields: {}, conflicts: [], warnings: [] };
}
