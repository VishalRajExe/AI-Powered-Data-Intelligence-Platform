import type { AgentResult, AgentRecord } from "../../agent/types.js";
import type { WorkflowPlan } from "../planner/workflow-plan.schema.js";

const COUNTRY_NAMES = buildCountryNames();

export interface ValidationSummary {
  issueCount: number;
  errorCount: number;
  warningCount: number;
  validRecordCount: number;
  invalidRecordCount: number;
  unsupportedRecordCount: number;
}

export class ValidationService {
  validate(result: AgentResult, plan: WorkflowPlan): { result: AgentResult; summary: ValidationSummary } {
    const toolVerifiedUrls = new Set(result.sources.filter(({ verifiedByTool }) => verifiedByTool).map(({ canonicalUrl, url }) => canonicalUrlize(canonicalUrl || url)).filter(Boolean));
    let issueCount = 0;
    let errorCount = 0;
    let warningCount = 0;
    let validRecordCount = 0;
    let unsupportedRecordCount = 0;

    const records = result.records.map((record) => {
      const issues: NonNullable<AgentRecord["validationIssues"]> = [];
      const sourceUrls = record.sourceUrls.filter((value) => toolVerifiedUrls.has(canonicalUrlize(value)));
      if (sourceUrls.length === 0) {
        unsupportedRecordCount += 1;
        issues.push({ ruleCode: "SOURCE_EVIDENCE", severity: "ERROR", message: "Record has no URL observed in an enabled collection tool." });
      }

      for (const [fieldKey, property] of Object.entries(plan.extractionSchema.properties)) {
        const value = record.values[fieldKey];
        if (isMissing(value) && (plan.extractionSchema.required.includes(fieldKey) || plan.requirement.requiredFields.includes(fieldKey))) {
          issues.push({ fieldKey, ruleCode: "REQUIRED", severity: "ERROR", message: "Required field is missing." });
          continue;
        }
        if (isMissing(value)) continue;
        if (!matchesType(value, property.type)) {
          issues.push({ fieldKey, ruleCode: "TYPE", severity: "ERROR", message: `Expected ${property.type} value.` });
          continue;
        }
        if (property.format === "uri" && !isHttpUrl(value)) issues.push({ fieldKey, ruleCode: "URL", severity: "ERROR", message: "Value must be an absolute HTTP(S) URL." });
        if (property.format === "email" && !isEmail(value)) issues.push({ fieldKey, ruleCode: "EMAIL", severity: "ERROR", message: "Value must be a valid email address." });
        if ((property.format === "date" || property.format === "date-time") && !isDate(value, property.format)) issues.push({ fieldKey, ruleCode: "DATE", severity: "ERROR", message: "Value must be a valid date in the requested format." });
        if (property.enum && !property.enum.some((expected) => jsonEqual(expected, value))) issues.push({ fieldKey, ruleCode: "ENUM", severity: "ERROR", message: "Value is outside the allowed values for this field." });
        if (isCountryField(fieldKey) && !isCountry(value)) issues.push({ fieldKey, ruleCode: "COUNTRY", severity: "WARNING", message: "Value was not recognized as a country name or ISO 3166-1 alpha-2 code." });
      }

      for (const rule of plan.validationRules) {
        const fieldKey = rule.fieldKey ?? undefined;
        const value = fieldKey ? record.values[fieldKey] : undefined;
        let message: string | undefined;
        switch (rule.rule) {
          case "REQUIRED": if (isMissing(value)) message = rule.description; break;
          case "TYPE": if (fieldKey && value != null && !matchesType(value, plan.extractionSchema.properties[fieldKey]?.type)) message = rule.description; break;
          case "URL": if (fieldKey && value != null && !isHttpUrl(value)) message = rule.description; break;
          case "EMAIL": if (fieldKey && value != null && !isEmail(value)) message = rule.description; break;
          case "DATE": if (fieldKey && value != null && !isDate(value, plan.extractionSchema.properties[fieldKey]?.format === "date-time" ? "date-time" : "date")) message = rule.description; break;
          case "ENUM": if (fieldKey && value != null && !plan.extractionSchema.properties[fieldKey]?.enum?.some((expected) => jsonEqual(expected, value))) message = rule.description; break;
          case "COUNTRY": if (fieldKey && value != null && !isCountry(value)) message = rule.description; break;
          case "SOURCE_EVIDENCE": if (sourceUrls.length === 0) message = rule.description; break;
          case "RANGE": case "CUSTOM": message = `Rule requires machine-readable parameters and was not executed: ${rule.description}`; break;
        }
        if (message && !issues.some((issue) => issue.fieldKey === fieldKey && issue.ruleCode === rule.rule && issue.message === message)) {
          issues.push({ ...(fieldKey ? { fieldKey } : {}), ruleCode: rule.rule, severity: rule.rule === "RANGE" || rule.rule === "CUSTOM" ? "WARNING" : rule.severity, message: message.slice(0, 1000) });
        }
      }

      const isValid = issues.every((issue) => issue.severity !== "ERROR");
      issueCount += issues.length;
      errorCount += issues.filter((issue) => issue.severity === "ERROR").length;
      warningCount += issues.filter((issue) => issue.severity === "WARNING").length;
      if (isValid) validRecordCount += 1;
      const verificationState = sourceUrls.length ? "SOURCE_CITED_UNVERIFIED" as const : "UNSUPPORTED" as const;
      const fieldQuality = Object.fromEntries(Object.keys(plan.extractionSchema.properties).map((key) => [key, {
        confidence: valueConfidence(record.values[key], sourceUrls.length),
        verificationState: isConflictForField(record, key) ? "CONFLICTED" as const : verificationState,
        normalizationNotes: record.quality?.fields[key]?.normalizationNotes ?? [],
      }]));

      return {
        ...record,
        sourceUrls,
        validationIssues: issues,
        isValid,
        quality: {
          ...record.quality,
          fields: fieldQuality,
          conflicts: record.quality?.conflicts ?? [],
          warnings: record.quality?.warnings ?? [],
          evidenceScope: "RECORD_LEVEL" as const,
          confidence: valueConfidence(record.values, sourceUrls.length),
          verificationState,
        },
      };
    });

    return { result: { ...result, records }, summary: {
      issueCount, errorCount, warningCount, validRecordCount,
      invalidRecordCount: records.length - validRecordCount, unsupportedRecordCount,
    } };
  }
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password; } catch { return false; }
}

function matchesType(value: unknown, type: string | undefined): boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "array": return Array.isArray(value);
    case "object": return Boolean(value && typeof value === "object" && !Array.isArray(value));
    default: return true;
  }
}

function isEmail(value: unknown): boolean { return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(value); }
function isDate(value: unknown, format?: string): boolean {
  if (typeof value !== "string") return false;
  if (format === "date") return /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  return !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/u.test(value);
}
function isMissing(value: unknown): boolean { return value === undefined || value === null || (typeof value === "string" && value.trim() === ""); }
function isCountryField(fieldKey: string): boolean { return /(^|_)(country|nation)(_|$)/iu.test(fieldKey); }
function isCountry(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const candidate = value.trim();
  if (/^[A-Za-z]{2}$/u.test(candidate)) return COUNTRY_NAMES.has(candidate.toLocaleUpperCase());
  return [...COUNTRY_NAMES.values()].some((name) => name.toLocaleLowerCase() === candidate.toLocaleLowerCase());
}
function canonicalUrlize(value: string): string {
  try { const url = new URL(value); url.hash = ""; url.hostname = url.hostname.toLocaleLowerCase(); return url.toString().replace(/\/$/u, ""); } catch { return ""; }
}
function jsonEqual(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function isConflictForField(record: AgentRecord, key: string): boolean { return Boolean(record.quality?.conflicts.some((conflict) => conflict.fieldKey === key)); }
function valueConfidence(value: unknown, sourceCount: number): number { return value === null || value === undefined ? 0 : sourceCount ? Math.min(0.7, 0.45 + Math.max(0, sourceCount - 1) * 0.1) : 0.1; }
function buildCountryNames(): Map<string, string> {
  const names = new Map<string, string>();
  const display = new Intl.DisplayNames(["en"], { type: "region" });
  for (let first = 65; first <= 90; first += 1) for (let second = 65; second <= 90; second += 1) {
    const code = String.fromCharCode(first, second);
    const name = display.of(code);
    if (name && name !== code && name !== "Unknown Region") names.set(code, name);
  }
  return names;
}
