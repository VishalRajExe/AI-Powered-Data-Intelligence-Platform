import type { DataRequirement } from "../requirements/requirement.schema.js";

export const WORKFLOW_PLANNER_SYSTEM_PROMPT = `You design executable data-collection plans for a business data platform.
Return only a plan matching the supplied schema. Use only the declared safe step vocabulary. Choose steps, source types, query count, and interaction needs for this particular requirement; do not repeat a generic pipeline when it is not suitable.
Never invent tools, credentials, access, or source permissions. All collection must be public and permitted: robots.txt and site terms must be respected, authentication and CAPTCHA bypass are forbidden, and per-domain request rates must stay within the configured policy. When an interaction is needed, represent it only as INTERACT and explain its safe purpose.
Use EXTRACT with an explicit schema for requested fields, VALIDATE for field/evidence checks, DEDUPLICATE/MERGE only with conservative rules, and SAVE for persistence. Cross-checking must be expressed using allowed steps such as VALIDATE, never an unsupported step type. Add SEARCH only when source discovery is needed. Make dependencies refer only to preceding steps. Every step starts PENDING and must have a bounded retry policy and timeout. State measurable completion criteria and require source evidence. Do not execute collection.`;

export function buildWorkflowPlanPrompt(requirement: DataRequirement, correction?: string[]): string {
  return [
    "Create one workflow plan for this validated structured data requirement.",
    "Return an object with exactly these top-level keys: objective, constraints, sourcePolicy, searchStrategy, steps, extractionSchema, transformations, validationRules, deduplicationRules, completionCriteria, outputConfiguration.",
    "Each step has id, type, description, input, configuration, dependencies, retryPolicy, timeoutMs, expectedOutput, and status. Each extraction schema has type='object', properties, required, and additionalProperties=false. Include every requested field, and mark requested required fields as required.",
    "Each source policy has permittedSourceTypes, allowedDomains (an optional restriction allowlist; use [] if none), preferredDomains, blockedDomains, respectRobotsTxt=true, respectSiteTerms=true, allowAuthentication=false, allowCaptchaBypass=false, maxRequestsPerDomainPerMinute, and policyRationale. Search strategy has queries, desiredSourceCount, maximumSourceCount, and selectionRationale.",
    "Completion criteria has targetRecordCount, minimumSources, requiredFieldsPresent, requireSourceEvidence=true, stopWhenTargetReached, allowPartialResults, and completionDescription. Output configuration has format, expectedColumns, includeSourceEvidence=true.",
    "Choose an appropriate and requirement-specific sequence; include only necessary steps. The workflow must stop at planning and must not claim that collection has already happened.",
    "Preserve the requested fields, constraints, source preferences/restrictions, quantity, filters, and output format. Do not add unsupported facts or infer missing details.",
    "The policy schema requires public permitted sources, robots.txt and terms compliance, no authentication, and no CAPTCHA bypass.",
    "Validated requirement:",
    JSON.stringify(requirement),
    ...(correction?.length ? ["The previous plan was rejected. Correct all of these schema/semantic issues and return a complete replacement plan:", JSON.stringify(correction)] : []),
  ].join("\n\n");
}
