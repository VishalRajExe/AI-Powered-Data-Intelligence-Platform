import type { AgentResult } from "../../agent/types.js";
import type { WorkflowPlan } from "../planner/workflow-plan.schema.js";

const ALIASES: Record<string, string[]> = {
  company_name: ["company", "organization", "organisation", "business", "companyname", "organizationname", "organisationname"],
  person_name: ["person", "contact", "contactname", "fullname", "foundername"],
  website: ["url", "web", "homepage", "companyurl", "websiteurl"],
  email: ["e-mail", "emailaddress", "contactemail"],
  phone: ["telephone", "phonenumber", "contactnumber", "mobile"],
  linkedin_url: ["linkedin", "linkedinprofile", "linkedinprofileurl"],
  country: ["nation", "countryname", "countrycode"],
  founded_date: ["foundingdate", "datefounded", "founded", "establisheddate"],
};

const EMPTY_VALUES = new Set(["", "null", "n/a", "na", "none", "not available", "not provided"]);
const COUNTRY_NAMES = buildCountryNames();

export class NormalizationService {
  normalize(result: AgentResult, plan: WorkflowPlan): AgentResult {
    const fieldMap = createFieldMap(plan);
    const records = result.records.map((record) => {
      const rawValues = record.rawValues ?? structuredClone(record.values);
      const recordWithoutValidity = omitKeys(record, ["isValid"]);
      const priorQuality = omitKeys(record.quality ?? {
        confidence: 0,
        verificationState: "UNSUPPORTED" as const,
        evidenceScope: "RECORD_LEVEL" as const,
        fields: {},
        conflicts: [],
        warnings: [],
      }, ["duplicate", "duplicateOfIndex"]);
      const notesByField: Record<string, string[]> = {};
      const values: Record<string, unknown> = {};

      for (const [sourceKey, rawValue] of Object.entries(record.values)) {
        const targetKey = fieldMap.get(normalizeKey(sourceKey)) ?? sourceKey;
        const property = plan.extractionSchema.properties[targetKey];
        const notes: string[] = [];
        const value = normalizeValue(rawValue, targetKey, property?.type, plan.transformations, notes);
        if (targetKey in values && !deepEqual(values[targetKey], value)) {
          notes.push(`Conflicting aliases were supplied for ${targetKey}; the first non-empty value was retained.`);
        }
        if (!(targetKey in values) || (isEmpty(values[targetKey]) && !isEmpty(value))) values[targetKey] = value;
        if (notes.length) notesByField[targetKey] = [...(notesByField[targetKey] ?? []), ...notes];
      }

      for (const key of Object.keys(plan.extractionSchema.properties)) {
        if (!(key in values)) values[key] = null;
      }

      return {
        ...recordWithoutValidity,
        rawValues,
        values,
        quality: {
          ...priorQuality,
          fields: Object.fromEntries(Object.keys(plan.extractionSchema.properties).map((fieldKey) => [fieldKey, {
            confidence: 0,
            verificationState: "UNSUPPORTED" as const,
            normalizationNotes: [...(record.quality?.fields[fieldKey]?.normalizationNotes ?? []), ...(notesByField[fieldKey] ?? [])],
          }])),
          conflicts: [],
          warnings: priorQuality.warnings,
          evidenceScope: "RECORD_LEVEL" as const,
          confidence: 0,
          verificationState: "UNSUPPORTED" as const,
        },
        validationIssues: [],
      };
    });
    const resultWithoutAssessment = omitKeys(result, ["dataQuality"]);
    return { ...resultWithoutAssessment, records };
  }
}

function omitKeys<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K> {
  const result = { ...value };
  for (const key of keys) delete result[key];
  return result;
}

function createFieldMap(plan: WorkflowPlan): Map<string, string> {
  const map = new Map<string, string>();
  const keys = Object.keys(plan.extractionSchema.properties);
  for (const key of keys) map.set(normalizeKey(key), key);
  for (const [key, aliases] of Object.entries(ALIASES)) {
    const target = keys.find((candidate) => normalizeKey(candidate) === normalizeKey(key));
    if (!target) continue;
    for (const alias of aliases) map.set(normalizeKey(alias), target);
  }
  for (const [fieldKey, property] of Object.entries(plan.extractionSchema.properties)) {
    const label = normalizeKey(property.description);
    if (label && label.length <= 64) map.set(label, fieldKey);
  }
  return map;
}

function normalizeValue(value: unknown, fieldKey: string, expectedType: string | undefined, transformations: WorkflowPlan["transformations"], notes: string[]): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    let normalized = value.trim().replace(/\s+/gu, " ");
    if (EMPTY_VALUES.has(normalized.toLocaleLowerCase())) return null;
    const field = normalizeKey(fieldKey);
    if (field === "email" || field.includes("email")) normalized = normalized.toLocaleLowerCase();
    if (field === "country" || field.endsWith("country")) normalized = normalizeCountry(normalized);

    if (isUrlField(field, expectedType) || hasTransform(transformations, fieldKey, "NORMALIZE_URL")) {
      const url = normalizeUrl(normalized);
      if (url) normalized = url;
    }
    if (isDateField(field, expectedType) || hasTransform(transformations, fieldKey, "NORMALIZE_DATE")) {
      const date = normalizeDate(normalized);
      if (date) normalized = date;
    }
    if (isPhoneField(field) || hasTransform(transformations, fieldKey, "NORMALIZE_PHONE")) {
      const phone = normalizePhone(normalized);
      if (phone) normalized = phone;
    }
    if (hasTransform(transformations, fieldKey, "NORMALIZE_CURRENCY") || isCurrencyField(field)) {
      const currency = normalizeCurrency(normalized, expectedType);
      if (currency.value !== undefined) {
        if (currency.note) notes.push(currency.note);
        return currency.value;
      }
    }
    if (expectedType === "number" || expectedType === "integer" || hasTransform(transformations, fieldKey, "PARSE_NUMBER")) {
      const number = parseNumber(normalized);
      if (number !== undefined) return number;
    }
    return normalized;
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => normalizeValue(item, fieldKey, undefined, transformations, notes)).filter((item) => item !== null);
    return items.length ? items : null;
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeValue(item, key, undefined, transformations, notes)]));
  }
  return value;
}

function normalizeKey(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase().replace(/[^a-z0-9]/gu, ""); }
function hasTransform(transformations: WorkflowPlan["transformations"], key: string, operation: string): boolean { return transformations.some((item) => item.fieldKey === key && item.operation === operation); }
function isUrlField(field: string, expectedType?: string): boolean { return expectedType === "string" && (field === "url" || field.endsWith("url") || field === "website" || field === "domain"); }
function isDateField(field: string, expectedType?: string): boolean { return expectedType === "string" && (field.endsWith("date") || field.endsWith("_at") || field === "founded"); }
function isPhoneField(field: string): boolean { return field.includes("phone") || field.includes("mobile") || field.includes("telephone"); }
function isCurrencyField(field: string): boolean { return /funding|salary|price|revenue|amount|cost|budget|valuation/iu.test(field); }
function isEmpty(value: unknown): boolean { return value === null || value === undefined || (typeof value === "string" && EMPTY_VALUES.has(value.trim().toLocaleLowerCase())); }

function normalizeUrl(value: string): string | undefined {
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/iu.test(value) ? value : `https://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hostname = url.hostname.toLocaleLowerCase().replace(/^www\./u, "www.");
    url.hash = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString();
  } catch { return undefined; }
}

function normalizeDate(value: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/u.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

function normalizePhone(value: string): string | undefined {
  const digits = value.replace(/\D/gu, "");
  if (digits.length < 7 || digits.length > 15) return undefined;
  return `${value.trim().startsWith("+") ? "+" : ""}${digits}`;
}

function parseNumber(value: string): number | undefined {
  const suffix = value.match(/(?:\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|trillion|k|m|b|t)\b/iu)?.[1]?.toLocaleLowerCase();
  const normalized = value.replace(/[\s,]/gu, "").replace(/[^\d.+-]/gu, "");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/u.test(normalized)) return undefined;
  const parsed = Number(normalized);
  const multiplier = suffix === "thousand" || suffix === "k" ? 1_000
    : suffix === "million" || suffix === "m" ? 1_000_000
      : suffix === "billion" || suffix === "b" ? 1_000_000_000
        : suffix === "trillion" || suffix === "t" ? 1_000_000_000_000 : 1;
  const result = parsed * multiplier;
  return Number.isFinite(result) ? result : undefined;
}

function normalizeCurrency(value: string, expectedType?: string): { value?: unknown; note?: string } {
  const codeFromSymbol: Record<string, string> = { "$": "USD", "€": "EUR", "£": "GBP", "₹": "INR", "¥": "JPY" };
  const symbol = Object.keys(codeFromSymbol).find((candidate) => value.includes(candidate));
  const code = value.match(/\b(USD|EUR|GBP|INR|JPY|CAD|AUD|CNY)\b/iu)?.[1]?.toLocaleUpperCase() ?? (symbol ? codeFromSymbol[symbol] : undefined);
  const amount = parseNumber(value);
  if (amount === undefined) return {};
  if (expectedType === "number" || expectedType === "integer") {
    return { value: amount, ...(code ? { note: `Currency code ${code} retained in rawValues; normalized numeric value is amount-only.` } : {}) };
  }
  return { value: code ? `${code} ${amount}` : `${amount}` };
}

function normalizeCountry(value: string): string {
  const folded = value.trim().toLocaleLowerCase().replace(/[.]/gu, "").replace(/\s+/gu, " ");
  if (/^[a-z]{2}$/iu.test(folded)) return COUNTRY_NAMES.get(folded.toLocaleUpperCase()) ?? value.trim();
  const match = [...COUNTRY_NAMES.entries()].find(([, name]) => name.toLocaleLowerCase() === folded);
  return match?.[1] ? COUNTRY_NAMES.get(match[0]) ?? value.trim() : value.trim().replace(/\s+/gu, " ");
}

function buildCountryNames(): Map<string, string> {
  const names = new Map<string, string>();
  const display = new Intl.DisplayNames(["en"], { type: "region" });
  for (let first = 65; first <= 90; first += 1) for (let second = 65; second <= 90; second += 1) {
    const code = String.fromCharCode(first, second);
    try {
      const name = display.of(code);
      if (name && name !== code && name !== "Unknown Region") names.set(code, name);
    } catch { /* Invalid region codes are omitted. */ }
  }
  names.set("US", "United States");
  names.set("GB", "United Kingdom");
  names.set("IN", "India");
  return names;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
