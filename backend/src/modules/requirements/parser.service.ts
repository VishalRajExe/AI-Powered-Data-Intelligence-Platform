import type { Logger } from "pino";
import { AppError } from "../../common/errors.js";
import { DataRequirementSchema, type DataRequirement } from "./requirement.schema.js";
import type { RequirementModelProvider } from "./provider.js";

export type RequirementValidationStatus = "valid" | "needs_clarification";

export interface ParsedRequirementResult {
  parsedRequirement: DataRequirement;
  validationStatus: RequirementValidationStatus;
  warnings: string[];
  missingInformation: string[];
}

export interface RequirementParser {
  parse(prompt: string): Promise<ParsedRequirementResult>;
}

export class RequirementParserService implements RequirementParser {
  constructor(
    private readonly provider: RequirementModelProvider,
    private readonly logger?: Logger,
  ) {}

  async parse(prompt: string): Promise<ParsedRequirementResult> {
    let output: unknown;
    try {
      output = await this.provider.generateRequirement(prompt);
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger?.warn({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Requirement provider failed");
      throw new AppError("Requirement analysis failed. Please retry.", 503, "REQUIREMENT_PROVIDER_UNAVAILABLE");
    }

    const parsed = DataRequirementSchema.safeParse(output);
    if (!parsed.success) {
      this.logger?.warn({ issueCount: parsed.error.issues.length }, "Requirement provider returned invalid structured output");
      throw new AppError(
        "The requirement could not be validated. Please retry or clarify the request.",
        502,
        "INVALID_REQUIREMENT_OUTPUT",
        parsed.error.issues.map(({ path, message }) => ({ path: path.join("."), message })),
      );
    }

    return buildParseResult(parsed.data);
  }
}

function buildParseResult(requirement: DataRequirement): ParsedRequirementResult {
  const missingInformation = [...requirement.missingInformation];
  if (!requirement.objective) missingInformation.push("A clear objective for the requested dataset");
  if (!requirement.entityType) missingInformation.push("The kind of entity or information to collect");
  if (requirement.fields.length === 0) missingInformation.push("At least one requested field or attribute");

  const uniqueMissingInformation = [...new Set(missingInformation)];
  const warnings = [...requirement.warnings];
  if (requirement.deduplicationKeys.length === 0) {
    warnings.push("No clear deduplication key was identified from the requested fields.");
  }

  return {
    parsedRequirement: requirement,
    validationStatus: uniqueMissingInformation.length === 0 && requirement.ambiguities.length === 0
      ? "valid"
      : "needs_clarification",
    warnings: [...new Set(warnings)],
    missingInformation: uniqueMissingInformation,
  };
}
