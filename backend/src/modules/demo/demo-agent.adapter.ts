import type { Logger } from "pino";
import type {
  AgentAdapter,
  AgentConfigurationHealth,
  AgentExecutionInput,
  AgentResult,
  AgentSourceMetadata,
} from "../../agent/types.js";
import { resolveDemoScenario } from "./scenarios.data.js";
import { SourceValidator } from "../sources/SourceValidator.js";
import type { WorkflowSourceRepository } from "../../db/repositories/workflow-source.repository.js";

export class DemoAgentAdapter implements AgentAdapter {
  private readonly validator = new SourceValidator();

  constructor(
    private readonly logger?: Logger,
    private readonly sourceRepo?: WorkflowSourceRepository,
  ) {}

  checkConfiguration(): AgentConfigurationHealth {
    return {
      configured: true,
      provider: "demo-simulator",
      model: "seeded-demo-v1",
      missing: [],
    };
  }

  async execute(input: AgentExecutionInput): Promise<AgentResult> {
    const scenario = resolveDemoScenario(input.prompt || input.plan.objective);
    const now = new Date().toISOString();
    const stepType = input.stepType ?? "EXTRACT";

    this.logger?.info(
      {
        scenarioId: scenario.id,
        stepType,
        runId: input.runId,
        isDemoSimulated: true,
      },
      `[DEMO MODE] Executing deterministic demo simulation for scenario: ${scenario.name}`,
    );

    // Copy candidate sources
    const sources: AgentSourceMetadata[] = [...scenario.sources];

    // Persist discovered/scraped sources to database if sourceRepo is available
    if (this.sourceRepo && input.workspaceId && input.runId) {
      for (const s of sources) {
        const norm = this.validator.normalize(s.url);
        if ("hash" in norm) {
          try {
            await this.sourceRepo.upsertDiscovered({
              workspaceId: input.workspaceId,
              workflowRunId: input.runId,
              url: s.url,
              canonicalUrl: s.canonicalUrl,
              canonicalUrlHash: norm.hash,
              domain: s.domain,
              title: s.title,
            });
            if (s.verifiedByTool) {
              await this.sourceRepo.updateLifecycle(input.workspaceId, input.runId, norm.hash, {
                status: "COLLECTED",
                retrievedAt: new Date(s.retrievedAt || now),
              });
            } else {
              await this.sourceRepo.updateLifecycle(input.workspaceId, input.runId, norm.hash, {
                status: "FAILED",
                code: "HTTP_404_NOT_FOUND",
                reason: "Source unreachable (simulated 404)",
              });
            }
          } catch (err) {
            this.logger?.warn({ err, url: s.url }, "Failed to upsert demo source to repository");
          }
        }
      }
    }

    const execution = {
      provider: "demo-simulator",
      model: "seeded-demo-v1",
      startedAt: now,
      finishedAt: now,
      durationMs: 250,
      inputTokens: 750,
      outputTokens: 1500,
      totalTokens: 2250,
      toolCallCount: 6,
      toolsUsed: [`demo_${stepType.toLowerCase()}_tool`],
    };

    if (stepType === "SEARCH" || stepType === "SCRAPE") {
      const hasBrokenSource = sources.some((s) => !s.verifiedByTool);
      return {
        status: "COMPLETED",
        data: null,
        records: [],
        sources,
        execution,
        events: [
          {
            runId: input.runId ?? "demo-run",
            sequence: 1,
            type: "agent.progress",
            occurredAt: now,
            toolName: `demo_${stepType.toLowerCase()}_tool`,
            workflowStepType: stepType,
            summary: `[DEMO MODE] Discovered and processed ${sources.length} sources (simulated dataset)`,
          },
        ],
        errors: stepType === "SCRAPE" && hasBrokenSource ? [
          {
            code: "SOURCE_FETCH_ERROR",
            message: "Failed to fetch candidate source (HTTP 404 Not Found) — safely isolated without interrupting collection run",
            retryable: false,
          },
        ] : [],
      };
    }

    // EXTRACT step returns candidate records (including deliberate duplicates, conflicts, and validation issues)
    const records = scenario.records.map((r) => ({
      values: { ...r.values },
      rawValues: { ...r.rawValues, _isDemoSimulated: true, _provenance: "DEMO_SIMULATION" },
      sourceUrls: [...r.sourceUrls],
    }));

    return {
      status: "COMPLETED",
      data: null,
      records,
      sources,
      execution,
      events: [
        {
          runId: input.runId ?? "demo-run",
          sequence: 1,
          type: "agent.completed",
          occurredAt: now,
          toolName: "demo_structured_extractor",
          workflowStepType: "EXTRACT",
          summary: `[DEMO MODE] Extracted ${records.length} structured candidate records (simulated)`,
        },
      ],
      errors: [
        {
          code: "SOURCE_FETCH_ERROR",
          message: "Failed to fetch candidate source (HTTP 404 Not Found) — verified fault tolerance",
          retryable: false,
        },
      ],
    };
  }
}
