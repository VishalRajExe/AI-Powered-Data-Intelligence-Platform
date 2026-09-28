import type { AgentResult } from "../../agent/types.js";
import type { WorkflowPlan } from "../planner/workflow-plan.schema.js";
import { mergeIntoCanonical, normalizeText, stableJson } from "./recordMerge.js";
import type { DeduplicationEventRecord, DuplicateDecision, MatchType } from "./types.js";

export interface DeduplicationSummary {
  result: AgentResult;
  events: DeduplicationEventRecord[];
  duplicateCount: number;
  conflictCount: number;
}

export class DeduplicationService {
  deduplicate(result: AgentResult, plan: WorkflowPlan): DeduplicationSummary {
    const records = result.records;
    const indexes = new Map<string, number>();
    const events: DeduplicationEventRecord[] = [];
    let duplicateCount = 0;
    let conflictCount = 0;
    const rules = plan.deduplicationRules.filter((rule): rule is typeof rule & { strategy: "EXACT" | "NORMALIZED" } => rule.strategy !== "FUZZY_REVIEW");

    for (const [index, record] of records.entries()) {
      if (record.quality?.duplicateOfIndex !== undefined) continue;
      let match: { canonicalIndex: number; rule: WorkflowPlan["deduplicationRules"][number]; matchType: MatchType } | undefined;
      const candidateKeys: Array<{ indexKey: string; rule: typeof rules[number] }> = [];
      for (const rule of rules) {
        const key = keyFor(record.values, rule.keys, rule.strategy);
        if (!key) continue;
        const indexKey = rule.strategy + ":" + rule.keys.join(",") + ":" + key;
        candidateKeys.push({ indexKey, rule });
        const canonicalIndex = indexes.get(indexKey);
        if (canonicalIndex !== undefined) {
          match = { canonicalIndex, rule, matchType: rule.keys.some(isUrlField) ? "URL" : rule.strategy };
          break;
        }
      }
      if (!match) {
        for (const { indexKey } of candidateKeys) indexes.set(indexKey, index);
        continue;
      }

      const canonical = records[match.canonicalIndex]!;
      const duplicate = records[index]!;
      const decision: DuplicateDecision = "MERGED";
      const matchConfidence = match.matchType === "EXACT" ? 1 : 0.99;
      const conflicts = mergeIntoCanonical(canonical, duplicate);
      conflictCount += conflicts.length;
      duplicate.quality ??= emptyQuality();
      duplicate.quality.duplicateOfIndex = match.canonicalIndex;
      duplicate.quality.duplicate = {
        decision, matchType: match.matchType, confidence: matchConfidence,
        matchedFields: match.rule.keys, reason: "Matched a deterministic " + match.matchType.toLocaleLowerCase() + " key from the validated workflow plan.",
      };
      canonical.quality ??= emptyQuality();
      canonical.quality.duplicate = {
        decision: "LINKED", matchType: match.matchType, confidence: matchConfidence,
        matchedFields: match.rule.keys, reason: "This is the canonical row for one or more linked duplicate records.",
      };
      duplicateCount += 1;
      events.push({
        canonicalIndex: match.canonicalIndex, duplicateIndex: index, decision, matchType: match.matchType,
        confidence: matchConfidence, matchedFields: match.rule.keys,
        reason: conflicts.length ? "Linked as a duplicate; " + conflicts.length + " conflicting field value(s) were preserved for review." : "Linked to the canonical record; both source rows remain stored.",
      });
    }
    return { result: { ...result, records }, events, duplicateCount, conflictCount };
  }
}

function keyFor(values: Record<string, unknown>, fields: string[], strategy: string): string | undefined {
  const parts: string[] = [];
  for (const field of fields) {
    const value = values[field];
    if (value === null || value === undefined || value === "") return undefined;
    if (strategy === "NORMALIZED" || isUrlField(field)) {
      const normalized = typeof value === "string" ? (isUrlField(field) ? normalizeUrl(value) : normalizeText(value)) : stableJson(value);
      if (!normalized) return undefined;
      parts.push(normalized);
    } else parts.push(stableJson(value));
  }
  return parts.length ? parts.join("\u001f") : undefined;
}

function isUrlField(field: string): boolean { return /(^|_)(url|website|domain|linkedin)(_|$)/iu.test(field) || field.endsWith("_url"); }
function normalizeUrl(value: string): string | undefined {
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//iu.test(value) ? value : "https://" + value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.hash = "";
    url.hostname = url.hostname.toLocaleLowerCase().replace(/^www\./u, "");
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return (url.hostname + url.pathname + url.search).toLocaleLowerCase();
  } catch { return undefined; }
}

function emptyQuality() {
  return { confidence: 0, verificationState: "UNSUPPORTED" as const, evidenceScope: "RECORD_LEVEL" as const, fields: {}, conflicts: [], warnings: [] };
}
