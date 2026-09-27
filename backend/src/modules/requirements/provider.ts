import { generateObject } from "ai";
import { resolveModel, type ModelConfig } from "@aidp/firecrawl-agent-core";
import type { Logger } from "pino";
import { AppError } from "../../common/errors.js";
import { assertLlmCredentials, type AppConfig } from "../../config/env.js";
import { DataRequirementModelSchema } from "./requirement.schema.js";
import { buildRequirementPrompt, REQUIREMENT_SYSTEM_PROMPT } from "./prompt.js";

export interface RequirementModelProvider {
  generateRequirement(prompt: string): Promise<unknown>;
}

export class AiSdkRequirementProvider implements RequirementModelProvider {
  constructor(private readonly config: AppConfig, private readonly logger: Logger) {}

  async generateRequirement(prompt: string): Promise<unknown> {
    try {
      assertLlmCredentials(this.config);
    } catch (error) {
      const message = error instanceof Error ? error.message : "LLM configuration is incomplete";
      throw new AppError(message, 503, "LLM_CONFIGURATION_ERROR");
    }

    try {
      const model = await resolveModel(this.toModelConfig());
      const result = await generateObject({
        model,
        schema: DataRequirementModelSchema,
        system: REQUIREMENT_SYSTEM_PROMPT,
        prompt: buildRequirementPrompt(prompt),
        temperature: 0,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(30_000),
      });
      return result.object;
    } catch (error) {
      this.logger.warn({
        provider: this.config.LLM_PROVIDER,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Requirement model call failed");
      throw new AppError("Requirement analysis is temporarily unavailable. Please retry.", 503, "REQUIREMENT_PROVIDER_UNAVAILABLE");
    }
  }

  private toModelConfig(): ModelConfig {
    const apiKey = {
      google: this.config.GOOGLE_GENERATIVE_AI_API_KEY,
      anthropic: this.config.ANTHROPIC_API_KEY,
      openai: this.config.OPENAI_API_KEY,
      gateway: this.config.AI_GATEWAY_API_KEY,
      "custom-openai": this.config.CUSTOM_OPENAI_API_KEY,
    }[this.config.LLM_PROVIDER];
    const baseURL = this.config.LLM_PROVIDER === "custom-openai" ? this.config.CUSTOM_OPENAI_BASE_URL : undefined;

    if (!apiKey || !this.config.LLM_MODEL_ID) {
      throw new AppError("LLM provider configuration is incomplete", 503, "LLM_CONFIGURATION_ERROR");
    }
    return {
      provider: this.config.LLM_PROVIDER,
      model: this.config.LLM_MODEL_ID,
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    };
  }
}
