import { randomUUID } from "node:crypto";
import type { AgentAdapter, AgentConfigurationHealth, AgentExecutionEvent, AgentExecutionInput, AgentResult } from "./types.js";

export class MockAgentAdapter implements AgentAdapter {
  readonly inputs: AgentExecutionInput[] = [];
  private readonly fixture: (input: AgentExecutionInput) => AgentResult;

  constructor(fixture: (input: AgentExecutionInput) => AgentResult = defaultFixture) {
    this.fixture = fixture;
  }

  checkConfiguration(): AgentConfigurationHealth {
    return { configured: true, provider: "mock", model: "mock-agent", missing: [] };
  }

  async execute(input: AgentExecutionInput): Promise<AgentResult> {
    this.inputs.push(input);
    const result = this.fixture(input);
    for (const event of result.events) input.onEvent?.(event);
    return structuredClone(result);
  }
}

function defaultFixture(input: AgentExecutionInput): AgentResult {
  const now = new Date().toISOString();
  const runId = input.runId ?? randomUUID();
  const event: AgentExecutionEvent = {
    runId,
    sequence: 1,
    type: "agent.completed",
    occurredAt: now,
    summary: "Mock agent completed",
  };
  return {
    status: "COMPLETED",
    data: { records: [] },
    records: [],
    sources: [],
    execution: {
      provider: "mock",
      model: "mock-agent",
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      toolCallCount: 0,
      toolsUsed: [],
    },
    events: [event],
    errors: [],
  };
}
