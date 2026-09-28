import { z } from "zod";
import { DataRequirementSchema } from "../requirements/requirement.schema.js";

const FieldKey = z.string().regex(/^[a-z][a-z0-9_]{0,127}$/);
const JsonValue: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(JsonValue), z.record(z.string(), JsonValue),
]));

export const WorkflowStepTypeSchema = z.enum([
  "SEARCH", "SCRAPE", "INTERACT", "EXTRACT", "TRANSFORM", "VALIDATE", "DEDUPLICATE", "MERGE", "SAVE", "EXPORT",
]);

const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(5),
  backoff: z.enum(["none", "exponential"]),
  initialDelayMs: z.number().int().min(0).max(60_000),
  multiplier: z.number().min(1).max(5),
  maxDelayMs: z.number().int().min(0).max(300_000),
  retryableErrors: z.array(z.enum(["TIMEOUT", "RATE_LIMIT", "TRANSIENT_NETWORK", "SERVER_ERROR"])).max(4),
}).strict().superRefine((policy, context) => {
  if (policy.backoff === "none" && (policy.initialDelayMs !== 0 || policy.multiplier !== 1)) {
    context.addIssue({ code: "custom", path: ["initialDelayMs"], message: "No-backoff policy requires zero delay and multiplier 1" });
  }
  if (policy.maxDelayMs < policy.initialDelayMs) {
    context.addIssue({ code: "custom", path: ["maxDelayMs"], message: "Maximum delay must be at least the initial delay" });
  }
});

export const WorkflowStepSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
  type: WorkflowStepTypeSchema,
  description: z.string().trim().min(1).max(500),
  input: z.record(z.string(), JsonValue),
  configuration: z.record(z.string(), JsonValue),
  dependencies: z.array(z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/)).max(30),
  retryPolicy: RetryPolicySchema,
  timeoutMs: z.number().int().min(1_000).max(300_000),
  expectedOutput: z.string().trim().min(1).max(500),
  status: z.literal("PENDING"),
}).strict();

const ExtractionPropertySchema = z.object({
  type: z.enum(["string", "number", "integer", "boolean", "array", "object"]),
  description: z.string().trim().min(1).max(500),
  format: z.enum(["date", "date-time", "uri", "email"]).optional(),
}).strict();

export const ExtractionSchema = z.object({
  type: z.literal("object"),
  properties: z.record(FieldKey, ExtractionPropertySchema),
  required: z.array(FieldKey),
  additionalProperties: z.literal(false),
}).strict();

const SourcePolicySchema = z.object({
  permittedSourceTypes: z.array(z.enum(["official_website", "job_board", "business_directory", "news", "research", "government", "marketplace", "other"])).min(1).max(8),
  allowedDomains: z.array(z.string().trim().min(1).max(255)).max(50).default([]),
  preferredDomains: z.array(z.string().trim().min(1).max(255)).max(50),
  blockedDomains: z.array(z.string().trim().min(1).max(255)).max(50),
  respectRobotsTxt: z.literal(true),
  respectSiteTerms: z.literal(true),
  allowAuthentication: z.literal(false),
  allowCaptchaBypass: z.literal(false),
  maxRequestsPerDomainPerMinute: z.number().int().min(1).max(60),
  policyRationale: z.string().trim().min(1).max(1000),
}).strict();

const SearchStrategySchema = z.object({
  queries: z.array(z.object({
    query: z.string().trim().min(2).max(500),
    sourceType: z.enum(["official_website", "job_board", "business_directory", "news", "research", "government", "marketplace", "other"]),
    rationale: z.string().trim().min(1).max(500),
  }).strict()).max(30),
  desiredSourceCount: z.number().int().min(1).max(100),
  maximumSourceCount: z.number().int().min(1).max(200),
  selectionRationale: z.string().trim().min(1).max(1000),
}).strict().superRefine((strategy, context) => {
  if (strategy.maximumSourceCount < strategy.desiredSourceCount) {
    context.addIssue({ code: "custom", path: ["maximumSourceCount"], message: "Maximum source count must be at least desired source count" });
  }
});

const TransformationSchema = z.object({
  fieldKey: FieldKey.nullable(),
  operation: z.enum(["TRIM_WHITESPACE", "NORMALIZE_TEXT", "NORMALIZE_URL", "NORMALIZE_DATE", "NORMALIZE_CURRENCY", "PARSE_NUMBER", "NORMALIZE_PHONE"]),
  description: z.string().trim().min(1).max(500),
}).strict();

const ValidationRuleSchema = z.object({
  fieldKey: FieldKey.nullable(),
  rule: z.enum(["REQUIRED", "TYPE", "URL", "EMAIL", "DATE", "RANGE", "SOURCE_EVIDENCE", "CUSTOM"]),
  severity: z.enum(["ERROR", "WARNING"]),
  description: z.string().trim().min(1).max(500),
}).strict();

const DeduplicationRuleSchema = z.object({
  keys: z.array(FieldKey).min(1).max(20),
  strategy: z.enum(["EXACT", "NORMALIZED", "FUZZY_REVIEW"]),
  confidenceThreshold: z.number().min(0).max(1),
  ambiguousMatchAction: z.enum(["KEEP_SEPARATE", "REVIEW"]),
  rationale: z.string().trim().min(1).max(500),
}).strict();

const CompletionCriteriaSchema = z.object({
  targetRecordCount: z.number().int().positive().nullable(),
  minimumSources: z.number().int().positive().max(100).nullable(),
  requiredFieldsPresent: z.array(FieldKey).max(100),
  requireSourceEvidence: z.literal(true),
  stopWhenTargetReached: z.boolean(),
  allowPartialResults: z.boolean(),
  completionDescription: z.string().trim().min(1).max(1000),
}).strict();

const PlanDraftSchema = z.object({
  objective: z.string().trim().min(1).max(1000),
  constraints: z.array(z.string().trim().min(1).max(500)).max(100),
  sourcePolicy: SourcePolicySchema,
  searchStrategy: SearchStrategySchema,
  steps: z.array(WorkflowStepSchema).min(2).max(30),
  extractionSchema: ExtractionSchema,
  transformations: z.array(TransformationSchema).max(100),
  validationRules: z.array(ValidationRuleSchema).min(1).max(100),
  deduplicationRules: z.array(DeduplicationRuleSchema).min(1).max(30),
  completionCriteria: CompletionCriteriaSchema,
  outputConfiguration: z.object({
    format: z.enum(["csv", "json", "xlsx", "unspecified"]),
    expectedColumns: z.array(FieldKey).max(100),
    includeSourceEvidence: z.literal(true),
  }).strict(),
}).strict();

function validatePlanDraft(plan: z.infer<typeof PlanDraftSchema>, context: z.RefinementCtx): void {
  const stepIds = new Set<string>();
  const earlierSteps = new Set<string>();
  for (const [index, step] of plan.steps.entries()) {
    if (stepIds.has(step.id)) context.addIssue({ code: "custom", path: ["steps", index, "id"], message: "Step IDs must be unique" });
    for (const dependency of step.dependencies) {
      if (!earlierSteps.has(dependency)) context.addIssue({ code: "custom", path: ["steps", index, "dependencies"], message: `Dependency must refer to an earlier step: ${dependency}` });
    }
    stepIds.add(step.id);
    earlierSteps.add(step.id);
  }
  if (!plan.steps.some(({ type }) => type === "EXTRACT")) context.addIssue({ code: "custom", path: ["steps"], message: "Plan must include an EXTRACT step" });
  if (!plan.steps.some(({ type }) => type === "SAVE")) context.addIssue({ code: "custom", path: ["steps"], message: "Plan must include a SAVE step" });
  const propertyKeys = new Set(Object.keys(plan.extractionSchema.properties));
  for (const key of plan.extractionSchema.required) {
    if (!propertyKeys.has(key)) context.addIssue({ code: "custom", path: ["extractionSchema", "required"], message: `Required extraction field is undefined: ${key}` });
  }
  for (const key of plan.completionCriteria.requiredFieldsPresent) {
    if (!propertyKeys.has(key)) context.addIssue({ code: "custom", path: ["completionCriteria", "requiredFieldsPresent"], message: `Completion field is undefined: ${key}` });
  }
  for (const key of plan.outputConfiguration.expectedColumns) {
    if (!propertyKeys.has(key)) context.addIssue({ code: "custom", path: ["outputConfiguration", "expectedColumns"], message: `Output column is undefined: ${key}` });
  }
  for (const rule of plan.validationRules) {
    if (rule.fieldKey && !propertyKeys.has(rule.fieldKey)) context.addIssue({ code: "custom", path: ["validationRules"], message: `Validation field is undefined: ${rule.fieldKey}` });
  }
  for (const rule of plan.deduplicationRules) {
    for (const key of rule.keys) if (!propertyKeys.has(key)) context.addIssue({ code: "custom", path: ["deduplicationRules"], message: `Deduplication field is undefined: ${key}` });
  }
}

export const WorkflowPlanDraftSchema = PlanDraftSchema.superRefine(validatePlanDraft);

export const WorkflowPlanSchema = PlanDraftSchema.extend({
  version: z.literal(1),
  requirement: DataRequirementSchema,
}).superRefine((plan, context) => {
  validatePlanDraft(plan, context);
  const propertyKeys = new Set(Object.keys(plan.extractionSchema.properties));
  for (const field of plan.requirement.fields) {
    if (!propertyKeys.has(field.key)) {
      context.addIssue({ code: "custom", path: ["extractionSchema", "properties", field.key], message: `Requested field is missing from extraction schema: ${field.key}` });
    }
  }
  for (const field of plan.requirement.requiredFields) {
    if (!plan.extractionSchema.required.includes(field)) {
      context.addIssue({ code: "custom", path: ["extractionSchema", "required"], message: `Required requested field is not required in extraction schema: ${field}` });
    }
  }
});

export const PlanWorkflowRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  createdById: z.string().uuid(),
  requirement: DataRequirementSchema,
  originalPrompt: z.string().trim().min(5).max(4_000).optional(),
}).strict();

export type WorkflowPlanDraft = z.infer<typeof WorkflowPlanDraftSchema>;
export type WorkflowPlan = z.infer<typeof WorkflowPlanSchema>;
export type PlanWorkflowRequest = z.infer<typeof PlanWorkflowRequestSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
