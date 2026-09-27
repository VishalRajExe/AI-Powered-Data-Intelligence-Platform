import { z } from "zod";

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]));

export const RequirementFieldSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,127}$/),
  label: z.string().trim().min(1).max(160),
  type: z.enum(["string", "number", "boolean", "date", "datetime", "url", "email", "currency", "json", "unknown"]),
  description: z.string().trim().max(500).nullable(),
}).strict();

export const RequirementFilterSchema = z.object({
  field: z.string().trim().min(1).max(160),
  operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in", "between", "before", "after", "exists"]),
  value: JsonValueSchema,
}).strict();

export const RequirementTimeRangeSchema = z.object({
  field: z.string().trim().max(160).nullable(),
  after: z.string().trim().max(80).nullable(),
  before: z.string().trim().max(80).nullable(),
  on: z.string().trim().max(80).nullable(),
  expression: z.string().trim().max(240).nullable(),
}).strict();

export const DataRequirementModelSchema = z.object({
  objective: z.string().trim().max(1000).nullable(),
  entityType: z.string().trim().max(120).nullable(),
  quantity: z.number().int().positive().safe().nullable(),
  geography: z.object({
    places: z.array(z.string().trim().min(1).max(160)).max(30),
    scope: z.enum(["unspecified", "global", "country", "region", "locality", "multiple"]),
    includeSubregions: z.boolean().nullable(),
  }).strict(),
  timeRange: RequirementTimeRangeSchema,
  filters: z.array(RequirementFilterSchema).max(100),
  constraints: z.array(z.string().trim().min(1).max(500)).max(100),
  fields: z.array(RequirementFieldSchema).max(100),
  requiredFields: z.array(z.string().trim().regex(/^[a-z][a-z0-9_]{0,127}$/)).max(100),
  optionalFields: z.array(z.string().trim().regex(/^[a-z][a-z0-9_]{0,127}$/)).max(100),
  sourcePreferences: z.array(z.string().trim().min(1).max(300)).max(50),
  sourceRestrictions: z.array(z.string().trim().min(1).max(300)).max(50),
  deduplicationKeys: z.array(z.string().trim().regex(/^[a-z][a-z0-9_]{0,127}$/)).max(30),
  validationRules: z.array(z.object({
    fieldKey: z.string().trim().regex(/^[a-z][a-z0-9_]{0,127}$/).nullable(),
    rule: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    severity: z.enum(["error", "warning"]),
  }).strict()).max(100),
  outputFormat: z.enum(["unspecified", "csv", "json", "xlsx"]),
  ambiguities: z.array(z.object({
    topic: z.string().trim().min(1).max(160),
    question: z.string().trim().min(1).max(500),
    context: z.string().trim().max(500).nullable(),
  }).strict()).max(30),
  missingInformation: z.array(z.string().trim().min(1).max(300)).max(30),
  warnings: z.array(z.string().trim().min(1).max(500)).max(30),
}).strict();

export const DataRequirementSchema = DataRequirementModelSchema.superRefine((requirement, context) => {
  const fieldKeys = new Set(requirement.fields.map(({ key }) => key));
  if (fieldKeys.size !== requirement.fields.length) {
    context.addIssue({ code: "custom", path: ["fields"], message: "Field keys must be unique" });
  }

  const required = new Set(requirement.requiredFields);
  const optional = new Set(requirement.optionalFields);
  if (required.size !== requirement.requiredFields.length || optional.size !== requirement.optionalFields.length) {
    context.addIssue({ code: "custom", path: ["requiredFields"], message: "Required and optional field keys must not contain duplicates" });
  }
  for (const key of required) {
    if (!fieldKeys.has(key)) context.addIssue({ code: "custom", path: ["requiredFields"], message: `Unknown required field key: ${key}` });
    if (optional.has(key)) context.addIssue({ code: "custom", path: ["optionalFields"], message: `Field cannot be both required and optional: ${key}` });
  }
  for (const key of optional) {
    if (!fieldKeys.has(key)) context.addIssue({ code: "custom", path: ["optionalFields"], message: `Unknown optional field key: ${key}` });
  }
  for (const key of fieldKeys) {
    if (!required.has(key) && !optional.has(key)) {
      context.addIssue({ code: "custom", path: ["fields"], message: `Field must be categorized as required or optional: ${key}` });
    }
  }
  for (const key of requirement.deduplicationKeys) {
    if (!fieldKeys.has(key)) context.addIssue({ code: "custom", path: ["deduplicationKeys"], message: `Unknown deduplication field key: ${key}` });
  }
  for (const rule of requirement.validationRules) {
    if (rule.fieldKey !== null && !fieldKeys.has(rule.fieldKey)) {
      context.addIssue({ code: "custom", path: ["validationRules"], message: `Unknown validation field key: ${rule.fieldKey}` });
    }
  }
});

export const ParseRequirementRequestSchema = z.object({
  prompt: z.string().trim().min(5).max(4_000),
}).strict();

export type DataRequirement = z.infer<typeof DataRequirementSchema>;
export type RequirementModelOutput = z.infer<typeof DataRequirementModelSchema>;
export type ParseRequirementRequest = z.infer<typeof ParseRequirementRequestSchema>;
