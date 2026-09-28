import type { AgentRecord } from "../../agent/types.js";
import type { RecordConflict } from "./types.js";

export function mergeIntoCanonical(canonical: AgentRecord, alternate: AgentRecord): RecordConflict[] {
  const conflicts: RecordConflict[] = [];
  for (const [fieldKey, alternateValue] of Object.entries(alternate.values)) {
    const canonicalValue = canonical.values[fieldKey];
    if (isMissing(canonicalValue) && !isMissing(alternateValue)) {
      canonical.values[fieldKey] = alternateValue;
      continue;
    }
    if (isMissing(alternateValue) || equivalent(canonicalValue, alternateValue)) continue;
    conflicts.push({ fieldKey, canonicalValue, alternateValue, canonicalSourceUrls: [...canonical.sourceUrls], alternateSourceUrls: [...alternate.sourceUrls] });
  }
  canonical.sourceUrls = [...new Set([...canonical.sourceUrls, ...alternate.sourceUrls])];
  canonical.quality ??= { confidence: 0, verificationState: "SOURCE_CITED_UNVERIFIED", evidenceScope: "RECORD_LEVEL", fields: {}, conflicts: [], warnings: [] };
  canonical.quality.conflicts.push(...conflicts);
  if (conflicts.length) canonical.quality.verificationState = "CONFLICTED";
  return conflicts;
}

export function equivalent(left: unknown, right: unknown): boolean {
  if (typeof left === "string" && typeof right === "string") return normalizeText(left) === normalizeText(right);
  return stableJson(left) === stableJson(right);
}

export function normalizeText(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ");
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => JSON.stringify(key) + ":" + stableJson(item)).join(",") + "}";
  return JSON.stringify(value) ?? "undefined";
}

function isMissing(value: unknown): boolean { return value === null || value === undefined || (typeof value === "string" && value.trim() === ""); }
