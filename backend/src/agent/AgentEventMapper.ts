import type { AgentEvent } from "@aidp/firecrawl-agent-core";
import { parseToolResult } from "@aidp/firecrawl-agent-core";
import type { AgentExecutionEvent } from "./types.js";

const stepTypeByTool: Record<string, AgentExecutionEvent["workflowStepType"]> = {
  search: "SEARCH",
  scrape: "SCRAPE",
  interact: "INTERACT",
  formatOutput: "EXTRACT",
  bashExec: "TRANSFORM",
};

export class AgentEventMapper {
  constructor(private readonly clock: () => Date = () => new Date()) {}

  map(event: AgentEvent, runId: string, sequence: number): AgentExecutionEvent {
    const occurredAt = this.clock().toISOString();
    if (event.type === "tool-call") {
      const toolName = event.toolName ?? "unknown";
      return {
        runId,
        sequence,
        type: "agent.tool.started",
        occurredAt,
        toolName,
        ...(stepTypeByTool[toolName] ? { workflowStepType: stepTypeByTool[toolName] } : {}),
        summary: summarizeToolCall(toolName, event.input),
      };
    }
    if (event.type === "tool-result") {
      const toolName = event.toolName ?? "unknown";
      return {
        runId,
        sequence,
        type: "agent.tool.completed",
        occurredAt,
        toolName,
        ...(stepTypeByTool[toolName] ? { workflowStepType: stepTypeByTool[toolName] } : {}),
        summary: summarizeToolResult(toolName, event.output),
      };
    }
    if (event.type === "error") {
      return { runId, sequence, type: "agent.failed", occurredAt, summary: sanitize(event.error ?? "Agent execution failed") };
    }
    if (event.type === "done") {
      return {
        runId,
        sequence,
        type: "agent.completed",
        occurredAt,
        summary: `Agent completed in ${event.durationMs ?? 0} ms`,
        details: { durationMs: event.durationMs ?? 0, model: event.model ?? "unknown" },
      };
    }
    return {
      runId,
      sequence,
      type: "agent.progress",
      occurredAt,
      summary: `Agent emitted ${event.type} progress`,
      ...(event.type === "text" && event.content ? { details: { characterCount: event.content.length } } : {}),
    };
  }
}

function summarizeToolCall(toolName: string, input: unknown): string {
  const value = asRecord(input);
  if (toolName === "search") return `Searching the web${typeof value.query === "string" ? ` for ${value.query.slice(0, 180)}` : ""}`;
  if (["scrape", "interact"].includes(toolName)) {
    const domain = urlDomain(value.url);
    return domain ? `${toolName === "scrape" ? "Scraping" : "Interacting with"} ${domain}` : `${toolName} started`;
  }
  if (toolName === "formatOutput") return "Formatting structured extraction output";
  return `${toolName} started`;
}

function summarizeToolResult(toolName: string, output: unknown): string {
  const parsed = parseToolResult({ toolName, output });
  const payload = parsed.payload;
  if (payload.kind === "search") return payload.error ? `Search failed: ${sanitize(payload.error)}` : `Search returned ${payload.results.length} results`;
  if (["scrape", "interact", "map"].includes(payload.kind)) {
    const result = payload as Extract<typeof payload, { kind: "scrape" | "interact" | "map" }>;
    return result.error ? `${toolName} failed: ${sanitize(result.error)}` : `${toolName} returned content for ${urlDomain(result.url) ?? "a source"}`;
  }
  return `${toolName} completed`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function urlDomain(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try { return new URL(value).hostname.toLowerCase(); } catch { return undefined; }
}

function sanitize(message: string): string {
  return message.replace(/(?:fc-[a-zA-Z0-9_-]{12,}|AIza[\w-]{20,}|AQ\.[\w-]{10,})/g, "[REDACTED]").slice(0, 500);
}
