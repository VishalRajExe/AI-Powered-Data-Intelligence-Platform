import { generateObject } from "ai";
import { resolveModel, type ModelConfig } from "@aidp/firecrawl-agent-core";
import type { Logger } from "pino";
import { z } from "zod";
import { AppError } from "../../common/errors.js";
import { assertLlmCredentials, type AppConfig } from "../../config/env.js";
import type { DataRequirement } from "../requirements/requirement.schema.js";
import { buildWorkflowPlanPrompt, WORKFLOW_PLANNER_SYSTEM_PROMPT } from "./prompt.js";

// Keep the provider envelope permissive so the planner service can inspect an
// invalid plan and ask for one corrected version instead of failing inside SDK parsing.
const PlannerOutputEnvelopeSchema = z.record(z.string(), z.unknown());

export interface WorkflowPlanProvider {
  generatePlan(requirement: DataRequirement, correction?: string[]): Promise<unknown>;
}

export class AiSdkWorkflowPlanProvider implements WorkflowPlanProvider {
  constructor(private readonly config: AppConfig, private readonly logger: Logger) {}

  async generatePlan(requirement: DataRequirement, correction?: string[]): Promise<unknown> {
    try {
      assertLlmCredentials(this.config);
      const model = await resolveModel(this.toModelConfig());
      const result = await generateObject({
        model,
        schema: PlannerOutputEnvelopeSchema,
        system: WORKFLOW_PLANNER_SYSTEM_PROMPT,
        prompt: buildWorkflowPlanPrompt(requirement, correction),
        temperature: 0,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(45_000),
      });
      return result.object;
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.warn({
        provider: this.config.LLM_PROVIDER,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Workflow planning model call failed");
      throw new AppError("Workflow planning is temporarily unavailable. Please retry.", 503, "WORKFLOW_PLANNER_UNAVAILABLE");
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
