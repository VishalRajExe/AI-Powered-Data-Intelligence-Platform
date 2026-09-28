import { parseToolResult } from "@aidp/firecrawl-agent-core";
import type { RunResult, StepDetail } from "@aidp/firecrawl-agent-core";
import type { AgentExecutionError, AgentExecutionMetadata, AgentRecord, AgentResult, AgentSourceMetadata } from "./types.js";

export interface AgentResultInput {
  text: string;
  steps: StepDetail[];
  model?: string;
  durationMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  schemaMismatch?: { missing: string[]; extra: string[] };
  provider: string;
  startedAt: Date;
  finishedAt: Date;
}

export class AgentResultNormalizer {
  normalize(input: AgentResultInput): AgentResult {
    const data = parseJson(input.text);
    const observed = collectToolSources(input.steps, input.finishedAt);
    const records = parseRecords(data);
    const errors: AgentExecutionError[] = collectToolErrors(input.steps);
    if (input.schemaMismatch && (input.schemaMismatch.missing.length || input.schemaMismatch.extra.length)) {
      errors.push({
        code: "OUTPUT_SCHEMA_MISMATCH",
        message: `Agent output did not match the extraction schema (${input.schemaMismatch.missing.length} missing, ${input.schemaMismatch.extra.length} extra fields).`,
        retryable: false,
      });
    }

    const sourceMap = new Map(observed.map((source) => [source.canonicalUrl, source]));
    for (const record of records) {
      for (const sourceUrl of record.sourceUrls) {
        const normalized = normalizeSource(sourceUrl, "model_reported", input.finishedAt);
        if (!normalized) continue;
        if (!sourceMap.has(normalized.canonicalUrl)) sourceMap.set(normalized.canonicalUrl, normalized);
      }
    }
    const sources = [...sourceMap.values()];
    const observedUrls = new Set(observed.map((source) => source.canonicalUrl));
    for (const record of records) {
      record.sourceUrls = record.sourceUrls.filter((url) => {
        const normalized = normalizeSource(url, "model_reported", input.finishedAt);
        return Boolean(normalized && observedUrls.has(normalized.canonicalUrl));
      });
    }
    if (records.some((record) => record.sourceUrls.length === 0)) {
      errors.push({ code: "SOURCE_EVIDENCE_UNVERIFIED", message: "One or more records lacked a source URL observed in Firecrawl tool results.", retryable: false });
    }

    const toolCallCount = input.steps.reduce((total, step) => total + step.toolCalls.length, 0);
    const toolsUsed = [...new Set(input.steps.flatMap((step) => step.toolCalls.map((call: { name: string }) => call.name)))];
    const durationMs = input.durationMs ?? Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime());
    const execution: AgentExecutionMetadata = {
      provider: input.provider,
      model: input.model ?? "unknown",
      startedAt: input.startedAt.toISOString(),
      finishedAt: input.finishedAt.toISOString(),
      durationMs,
      inputTokens: input.usage?.inputTokens ?? 0,
      outputTokens: input.usage?.outputTokens ?? 0,
      totalTokens: input.usage?.totalTokens ?? 0,
      toolCallCount,
      toolsUsed,
    };
    const status = errors.length === 0 && records.length > 0
      ? "COMPLETED"
      : records.length > 0 || sources.length > 0 ? "PARTIAL" : "FAILED";
    return { status, data, records, sources, execution, events: [], errors };
  }

  normalizeFailure(input: { provider: string; model: string | null; startedAt: Date; finishedAt: Date; message: string; code?: string }): AgentResult {
    const durationMs = Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime());
    return {
      status: "FAILED",
      data: null,
      records: [],
      sources: [],
      execution: {
        provider: input.provider,
        model: input.model ?? "unknown",
        startedAt: input.startedAt.toISOString(),
        finishedAt: input.finishedAt.toISOString(),
        durationMs,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        toolCallCount: 0,
        toolsUsed: [],
      },
      events: [],
      errors: [{ code: input.code ?? "AGENT_EXECUTION_FAILED", message: input.message.slice(0, 500), retryable: true }],
    };
  }
}

export function resultToNormalizerInput(result: RunResult, provider: string, startedAt: Date, finishedAt: Date): AgentResultInput {
  return {
    text: result.data ?? result.text,
    steps: result.steps,
    model: result.model,
    durationMs: result.durationMs,
    usage: result.usage,
    schemaMismatch: result.schemaMismatch,
    provider,
    startedAt,
    finishedAt,
  };
}

function parseRecords(data: unknown): AgentRecord[] {
  const object = asRecord(data);
  if (!Array.isArray(object.records)) return [];
  return object.records.flatMap((item): AgentRecord[] => {
    const record = asRecord(item);
    const values = asRecord(record.values);
    if (!Object.keys(values).length) return [];
    return [{ values, sourceUrls: uniqueStrings(record.sourceUrls) }];
  });
}

function collectToolSources(steps: StepDetail[], retrievedAt: Date): AgentSourceMetadata[] {
  const sources = new Map<string, AgentSourceMetadata>();
  for (const step of steps) {
    for (const result of step.toolResults) {
      const relatedCalls = step.toolCalls.filter((call: { name: string }) => call.name === result.name);
      const callIndex = step.toolResults.filter((candidate: { name: string }) => candidate.name === result.name).indexOf(result);
      const parsed = parseToolResult({ toolName: result.name, input: relatedCalls[callIndex]?.input, output: result.output });
      const payload = parsed.payload;
      if (payload.kind === "search") {
        for (const row of payload.results) {
          addSource(sources, normalizeSource(row.url, "search", retrievedAt, row.title, row.description));
        }
      } else if (payload.kind === "scrape" || payload.kind === "interact" || payload.kind === "map") {
        addSource(sources, normalizeSource(payload.url, payload.kind, retrievedAt, payload.pageTitle, payload.pageDescription ?? payload.markdown));
        for (const url of payload.links ?? []) addSource(sources, normalizeSource(url, "scrape", retrievedAt));
      }
    }
  }
  return [...sources.values()];
}

function collectToolErrors(steps: StepDetail[]): AgentExecutionError[] {
  const errors: AgentExecutionError[] = [];
  for (const step of steps) {
    for (const result of step.toolResults) {
      const parsed = parseToolResult({ toolName: result.name, output: result.output });
      const payload = parsed.payload as { error?: unknown };
      if (typeof payload.error === "string" && payload.error) {
        errors.push({ code: "FIRECRAWL_TOOL_ERROR", message: redact(payload.error), toolName: result.name, retryable: isRetryable(payload.error) });
      }
    }
  }
  return errors;
}

function normalizeSource(url: string, sourceType: AgentSourceMetadata["sourceType"], retrievedAt: Date, title?: string, snippet?: string): AgentSourceMetadata | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    parsed.hash = "";
    const canonicalUrl = parsed.toString().replace(/\/$/, parsed.pathname === "/" ? "/" : "");
    const normalized: AgentSourceMetadata = {
      url,
      canonicalUrl,
      domain: parsed.hostname.toLowerCase(),
      sourceType,
      retrievedAt: retrievedAt.toISOString(),
      verifiedByTool: sourceType !== "model_reported",
    };
    if (title?.trim()) normalized.title = title.trim().slice(0, 512);
    if (snippet?.trim()) normalized.snippet = snippet.trim().slice(0, 1000);
    return normalized;
  } catch { return undefined; }
}

function addSource(sources: Map<string, AgentSourceMetadata>, source?: AgentSourceMetadata): void {
  if (!source) return;
  const existing = sources.get(source.canonicalUrl);
  if (!existing || (!existing.title && source.title)) sources.set(source.canonicalUrl, source);
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function uniqueStrings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))] : [];
}

function redact(message: string): string {
  return message.replace(/(?:fc-[a-zA-Z0-9_-]{12,}|AIza[\w-]{20,})/g, "[REDACTED]").slice(0, 500);
}

function isRetryable(message: string): boolean {
  return /timeout|rate.?limit|temporar|network|\b5\d\d\b/i.test(message);
}
