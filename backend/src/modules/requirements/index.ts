import type { Logger } from "pino";
import type { AppConfig } from "../../config/env.js";
import { RequirementParserService } from "./parser.service.js";
import { AiSdkRequirementProvider } from "./provider.js";

export function createRequirementParser(config: AppConfig, logger: Logger): RequirementParserService {
  return new RequirementParserService(new AiSdkRequirementProvider(config, logger), logger);
}

export { RequirementParserService } from "./parser.service.js";
export type { ParsedRequirementResult, RequirementParser, RequirementValidationStatus } from "./parser.service.js";
export {
  DataRequirementModelSchema,
  DataRequirementSchema,
  ParseRequirementRequestSchema,
} from "./requirement.schema.js";
export type { DataRequirement, ParseRequirementRequest } from "./requirement.schema.js";
export type { RequirementModelProvider } from "./provider.js";
