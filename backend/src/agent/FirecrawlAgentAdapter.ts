import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { createAgent, buildFirecrawlToolkit, type AgentEvent, type CreateAgentOptions, type ModelConfig, type RunParams, type Toolkit } from "@aidp/firecrawl-agent-core";
import type { Logger } from "pino";
import type { AppConfig } from "../config/env.js";
import type { WorkflowPlan } from "../modules/planner/workflow-plan.schema.js";
import { AgentEventMapper } from "./AgentEventMapper.js";
import { AgentResultNormalizer } from "./AgentResultNormalizer.js";
import type { AgentAdapter, AgentConfigurationHealth, AgentExecutionEvent, AgentExecutionInput, AgentResult } from "./types.js";
import type { SourcePolicyService } from "../modules/sources/SourcePolicyService.js";
import type { SourceExecutionPolicy, SourcePolicyContext } from "../modules/sources/source-governance.types.js";
import { RelevantSourceSelector, sourceCandidate } from "../modules/sources/RelevantSourceSelector.js";

interface StreamableFirecrawlAgent {
  stream(params: RunParams): AsyncGenerator<AgentEvent>;
}

export type FirecrawlAgentFactory = (options: CreateAgentOptions) => StreamableFirecrawlAgent;

export class FirecrawlAgentAdapter implements AgentAdapter {
  private readonly normalizer = new AgentResultNormalizer();

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly agentFactory: FirecrawlAgentFactory = createAgent,
    private readonly eventMapper = new AgentEventMapper(),
    private readonly sourcePolicy?: SourcePolicyService,
  ) {}

  checkConfiguration(): AgentConfigurationHealth {
    const missing: string[] = [];
    if (!this.config.FIRECRAWL_API_KEY) missing.push("FIRECRAWL_API_KEY");
    const providerEnv = {
      google: "GOOGLE_GENERATIVE_AI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      gateway: "AI_GATEWAY_API_KEY",
      "custom-openai": "CUSTOM_OPENAI_API_KEY",
    }[this.config.LLM_PROVIDER];
    if (!getProviderKey(this.config)) missing.push(providerEnv);
    if (!this.config.LLM_MODEL_ID) missing.push("LLM_MODEL_ID");
    if (this.config.LLM_PROVIDER === "custom-openai" && !this.config.CUSTOM_OPENAI_BASE_URL) missing.push("CUSTOM_OPENAI_BASE_URL");
    return { configured: missing.length === 0, provider: this.config.LLM_PROVIDER, model: this.config.LLM_MODEL_ID ?? null, missing };
  }

  async execute(input: AgentExecutionInput): Promise<AgentResult> {
    const startedAt = new Date();
    const runId = input.runId ?? randomUUID();
    const health = this.checkConfiguration();
    if (!health.configured) {
      return this.normalizer.normalizeFailure({
        provider: this.config.LLM_PROVIDER,
        model: this.config.LLM_MODEL_ID ?? null,
        startedAt,
        finishedAt: new Date(),
        code: "AGENT_CONFIGURATION_ERROR",
        message: `Agent configuration is incomplete: ${health.missing.join(", ")}`,
      });
    }

    const enabled = allowedFirecrawlTools(input.plan, input.stepType);
    const firecrawlApiKey = this.config.FIRECRAWL_API_KEY!;
    const model: ModelConfig = {
      provider: this.config.LLM_PROVIDER,
      model: this.config.LLM_MODEL_ID!,
      apiKey: getProviderKey(this.config),
      ...(this.config.LLM_PROVIDER === "custom-openai" && this.config.CUSTOM_OPENAI_BASE_URL
        ? { baseURL: this.config.CUSTOM_OPENAI_BASE_URL }
        : {}),
    };
    const firecrawlOptions = {
      ...(this.config.FIRECRAWL_BASE_URL ? { apiUrl: this.config.FIRECRAWL_BASE_URL } : {}),
      search: enabled.has("search")
        ? { limit: Math.min(20, input.plan.searchStrategy.maximumSourceCount), excludeDomains: input.plan.sourcePolicy.blockedDomains }
        : false as const,
      scrape: enabled.has("scrape") ? { formats: ["markdown"] } : false as const,
      interact: enabled.has("interact") ? {} : false as const,
      map: false,
      crawl: false,
      interactTimeoutMs: stepTimeout(input.plan, "INTERACT", 60_000),
    };
    const baseToolkit = buildFirecrawlToolkit(firecrawlApiKey, firecrawlOptions);
    const toolkit = gateToolkit(baseToolkit, input.plan, this.logger, this.sourcePolicy, input);
    const options: CreateAgentOptions = {
      firecrawlApiKey,
      firecrawlOptions,
      toolkit,
      model,
      apiKeys: { [this.config.LLM_PROVIDER]: getProviderKey(this.config)! },
      maxSteps: Math.max(6, Math.min(40, input.plan.steps.length * 3)),
      maxWorkers: input.plan.searchStrategy.desiredSourceCount > 5 ? 3 : 1,
      workerMaxSteps: 8,
      appSections: [buildExecutionPolicy(input.plan, enabled)],
    };
    const events: AgentExecutionEvent[] = [];
    const emit = (event: AgentEvent): void => {
      const mapped = this.eventMapper.map(event, runId, events.length + 1);
      events.push(mapped);
      try { input.onEvent?.(mapped); }
      catch (error) { this.logger.warn({ runId, errorName: error instanceof Error ? error.name : "UnknownError" }, "Agent event consumer failed"); }
    };

    try {
      const agent = this.agentFactory(options);
      const urls = seedUrls(input.plan, undefined, input.sourceUrls, input.stepType);
      const result = await collectStream(agent.stream({
        prompt: buildAgentPrompt(input.prompt, input.plan, input.stepType, input.priorRecords, input.sourceUrls),
        ...(urls.length ? { urls } : {}),
        format: "json",
        schema: buildAgentOutputSchema(input.plan),
        columns: input.plan.outputConfiguration.expectedColumns,
        skills: ["structured-extraction"],
        skillInstructions: {
          "structured-extraction": "Follow the persisted WorkflowPlan and source policy. Only visit allowed public sources. Attach URLs actually observed in tool results to each record. Never invent values or bypass access restrictions.",
        },
      }), emit);
      const finishedAt = new Date();
      if (result.error) {
        return withEvents(this.normalizer.normalizeFailure({
          provider: this.config.LLM_PROVIDER,
          model: this.config.LLM_MODEL_ID ?? null,
          startedAt,
          finishedAt,
          code: "AGENT_EXECUTION_FAILED",
          message: redactSecrets(result.error, secrets(this.config)),
        }), events);
      }
      if (!result.completion) {
        return withEvents(this.normalizer.normalizeFailure({
          provider: this.config.LLM_PROVIDER,
          model: this.config.LLM_MODEL_ID ?? null,
          startedAt,
          finishedAt,
          code: "AGENT_EXECUTION_INCOMPLETE",
          message: "Firecrawl Agent Core ended without a completion result.",
        }), events);
      }
      const normalized = this.normalizer.normalize({
        text: result.completion.text ?? "",
        steps: result.completion.steps ?? [],
        model: result.completion.model,
        durationMs: result.completion.durationMs,
        usage: result.completion.usage,
        schemaMismatch: result.completion.schemaMismatch,
        provider: this.config.LLM_PROVIDER,
        startedAt,
        finishedAt,
      });
      return withEvents(normalized, events);
    } catch (error) {
      const finishedAt = new Date();
      const rawMessage = error instanceof Error ? error.message : "Firecrawl Agent Core failed";
      const message = redactSecrets(rawMessage, secrets(this.config));
      this.logger.error({ runId, provider: this.config.LLM_PROVIDER, errorName: error instanceof Error ? error.name : "UnknownError" }, "Firecrawl Agent Core execution failed");
      return withEvents(this.normalizer.normalizeFailure({
        provider: this.config.LLM_PROVIDER,
        model: this.config.LLM_MODEL_ID ?? null,
        startedAt,
        finishedAt,
        code: "AGENT_EXECUTION_FAILED",
        message,
      }), events);
    }
  }
}

function allowedFirecrawlTools(plan: WorkflowPlan, stepType?: AgentExecutionInput["stepType"]): Set<"search" | "scrape" | "interact"> {
  const enabled = new Set<"search" | "scrape" | "interact">();
  for (const step of plan.steps) {
    if (stepType && step.type !== stepType) continue;
    if (step.type === "SEARCH") enabled.add("search");
    if (step.type === "SCRAPE") enabled.add("scrape");
    if (step.type === "INTERACT") enabled.add("interact");
  }
  return enabled;
}

function buildAgentOutputSchema(plan: WorkflowPlan): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      records: {
        type: "array",
        items: {
          type: "object",
          properties: {
            values: plan.extractionSchema,
            sourceUrls: { type: "array", items: { type: "string", format: "uri" } },
          },
          required: ["values", "sourceUrls"],
          additionalProperties: false,
        },
      },
    },
    required: ["records"],
    additionalProperties: false,
  };
}

function buildAgentPrompt(prompt: string, plan: WorkflowPlan, stepType?: AgentExecutionInput["stepType"], priorRecords: AgentExecutionInput["priorRecords"] = [], sourceUrls: AgentExecutionInput["sourceUrls"] = []): string {
  const planTools = plan.steps.filter(({ type }) => ["SEARCH", "SCRAPE", "INTERACT"].includes(type) && (!stepType || type === stepType));
  const queries = plan.searchStrategy.queries.map(({ query, sourceType }) => `- [${sourceType}] ${query}`);
  const blockedDomains = plan.sourcePolicy.blockedDomains.map((domain) => domain.toLowerCase().replace(/^\*\./, ""));
  const stepText = planTools.map(({ type, description, input }) => {
    const query = typeof input.query === "string" ? `; query: ${input.query.slice(0, 500)}` : "";
    const urls = seedUrls({ ...plan, steps: [{ type, input } as WorkflowPlan["steps"][number]] }, blockedDomains);
    return `- ${type}: ${description}${query}${urls.length ? `; source URL(s): ${urls.join(", ")}` : ""}`;
  });
  return [
    "Execute the supplied, already-validated workflow plan using only its enabled Firecrawl tools and approved public sources.",
    "Do not add steps, visit blocked domains, log in, bypass authentication or CAPTCHAs, or ignore robots.txt/site terms. When a source is blocked, inaccessible, rate-limited, or fails, record/use the reason and continue with other allowed sources when available. Do not claim data is verified unless it came from tool results.",
    `User request: ${prompt}`,
    ...(stepType ? [`Current workflow step: ${stepType}. Complete only this step; previous dependencies have completed.`, `Source URLs from completed prerequisite steps: ${sourceUrls.join(", ") || "none"}`, `Structured results from completed prerequisite steps: ${JSON.stringify(priorRecords).slice(0, 12_000)}`] : []),
    `Objective: ${plan.objective}`,
    `Required fields: ${plan.requirement.requiredFields.join(", ") || "none"}`,
    `Requested fields: ${plan.extractionSchema.required.join(", ")}`,
    `Target records: ${plan.completionCriteria.targetRecordCount ?? "as many as the sources support"}`,
    `Maximum discovered sources: ${plan.searchStrategy.maximumSourceCount}`,
    "Planned collection steps:",
    ...(stepText.length ? stepText : ["- Use only supplied source URLs and the enabled scraping/interaction steps."]),
    "Approved search queries:",
    ...(queries.length ? queries : ["- Search is not part of this plan; do not use search."]),
    `Preferred domains: ${plan.sourcePolicy.preferredDomains.join(", ") || "none"}`,
    `Allowed domains: ${plan.sourcePolicy.allowedDomains.join(", ") || "any public domain not blocked by policy"}`,
    `Blocked domains: ${plan.sourcePolicy.blockedDomains.join(", ") || "none"}`,
    `Completion criteria: ${plan.completionCriteria.completionDescription}`,
    "Return JSON exactly as {records:[{values:<extraction schema object>,sourceUrls:[<URLs actually used>]}]}. Every record must cite at least one URL observed in an enabled Firecrawl tool result. Return an empty records array if sources contain no matching data; never fabricate values or sources.",
  ].join("\n\n");
}

function buildExecutionPolicy(plan: WorkflowPlan, enabled: Set<string>): string {
  return [
    "Platform execution policy:",
    `Enabled Firecrawl tool set: ${[...enabled].join(", ") || "none"}.`,
    `Respect robots.txt and site terms: ${plan.sourcePolicy.respectRobotsTxt && plan.sourcePolicy.respectSiteTerms}.`,
    "Do not use bashExec or exportSkill. Do not use authentication, private accounts, paywall/CAPTCHA bypass, or anti-bot evasion.",
    "Use formatOutput only to return the requested structured JSON. Do not add unsupported fields or claim an unvisited source was checked.",
  ].join("\n");
}

function gateToolkit(base: Toolkit, plan: WorkflowPlan, logger: Logger, sourcePolicy?: SourcePolicyService, execution?: AgentExecutionInput): Toolkit {
  const recentRequests = new Map<string, number[]>();
  const relevantSourceSelector = new RelevantSourceSelector();
  const blocked = plan.sourcePolicy.blockedDomains.map((domain) => domain.toLowerCase().replace(/^\*\./, ""));
  const maxPerMinute = plan.sourcePolicy.maxRequestsPerDomainPerMinute;
  const wrapToolset = (tools: Toolkit["tools"]): Toolkit["tools"] => {
    const wrapped = { ...tools } as Record<string, unknown>;
    const search = wrapped.search as { execute?: (input: unknown, options?: unknown) => Promise<unknown> } | undefined;
    if (search?.execute) {
      const execute = search.execute.bind(search);
      wrapped.search = {
        ...search,
        execute: async (input: unknown, options?: unknown) => {
          const result = await execute(input, options);
          return registerFilterAndRankSearchResults(result, plan, relevantSourceSelector,
            sourcePolicy,
            sourcePolicy && execution?.workspaceId && execution.runId
              ? { workspaceId: execution.workspaceId, workflowRunId: execution.runId, plan }
              : undefined);
        },
      };
    }
    for (const toolName of ["scrape", "interact"]) {
      const tool = wrapped[toolName] as { execute?: (input: unknown, options?: unknown) => Promise<unknown> } | undefined;
      if (!tool?.execute) continue;
      const execute = tool.execute.bind(tool);
      wrapped[toolName] = {
        ...tool,
        execute: async (input: unknown, options?: unknown) => {
          const rawUrl = asRecord(input).url;
          const url = typeof rawUrl === "string" ? rawUrl : "";
          if (sourcePolicy && execution?.workspaceId && execution.runId) {
            const stepType = toolName === "scrape" ? "SCRAPE" : "INTERACT";
            const step = plan.steps.find(({ type }) => type === stepType);
            const runParams = options && typeof options === "object" ? options as { abortSignal?: AbortSignal } : {};
            return sourcePolicy.execute({
              url,
              sourceType: toolName as "scrape" | "interact",
              context: { workspaceId: execution.workspaceId, workflowRunId: execution.runId, plan },
              timeoutMs: step?.timeoutMs ?? 60_000,
              retryPolicy: retryPolicy(step?.retryPolicy),
              operation: (signal) => execute(input, { ...runParams, abortSignal: signal }),
              ...(runParams.abortSignal ? { signal: runParams.abortSignal } : {}),
            });
          }
          const host = publicDomain(url);
          if (!host) return { error: "SOURCE_BLOCKED_BY_POLICY: only public HTTP(S) URLs are allowed" };
          if (blocked.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
            logger.info({ toolName, domain: host }, "Blocked source excluded by workflow policy");
            return { error: "SOURCE_BLOCKED_BY_POLICY" };
          }
          const now = Date.now();
          const recent = (recentRequests.get(host) ?? []).filter((time) => now - time < 60_000);
          if (recent.length >= maxPerMinute) return { error: "SOURCE_RATE_LIMITED" };
          recent.push(now);
          recentRequests.set(host, recent);
          return execute(input, options);
        },
      };
    }
    return wrapped as Toolkit["tools"];
  };
  return {
    tools: wrapToolset(base.tools),
    ...(base.systemPrompt ? { systemPrompt: base.systemPrompt } : {}),
    ...(base.createFiltered ? { createFiltered: (names?: string[]) => wrapToolset(base.createFiltered!(names)) } : {}),
  };
}

async function registerFilterAndRankSearchResults(
  result: unknown,
  plan: WorkflowPlan,
  selector: RelevantSourceSelector,
  sourcePolicy?: SourcePolicyService,
  context?: SourcePolicyContext,
): Promise<unknown> {
  const process = async (value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) {
      const candidates = value.filter((item) => sourceCandidate(item) !== undefined);
      if (candidates.length) {
        const allowed: unknown[] = [];
        for (const item of candidates) {
          const candidate = sourceCandidate(item)!;
          if (sourcePolicy && context && !(await sourcePolicy.discover(candidate.url, context, { title: candidate.title, snippet: candidate.snippet })).allowed) continue;
          allowed.push(item);
        }
        const ranked = new Set(selector.rank(allowed, plan, plan.searchStrategy.maximumSourceCount));
        const output: unknown[] = [];
        for (const item of value) {
          if (sourceCandidate(item)) {
            if (ranked.has(item)) output.push(item);
          } else output.push(await process(item));
        }
        return output;
      }
      return Promise.all(value.map(process));
    }
    if (!value || typeof value !== "object") return value;
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) output[key] = await process(nested);
    return output;
  };
  return process(result);
}

function retryPolicy(input: WorkflowPlan["steps"][number]["retryPolicy"] | undefined): SourceExecutionPolicy {
  return input ?? {
    maxAttempts: 1, backoff: "none", initialDelayMs: 0, multiplier: 1, maxDelayMs: 0, retryableErrors: [],
  };
}

async function collectStream(stream: AsyncGenerator<AgentEvent>, emit: (event: AgentEvent) => void): Promise<{ completion?: Extract<AgentEvent, { type: "done" }>; error?: string }> {
  let completion: Extract<AgentEvent, { type: "done" }> | undefined;
  let error: string | undefined;
  for await (const event of stream) {
    emit(event);
    if (event.type === "done") completion = event;
    if (event.type === "error") error = event.error ?? "Firecrawl Agent Core reported an error";
  }
  return { ...(completion ? { completion } : {}), ...(error ? { error } : {}) };
}

function stepTimeout(plan: WorkflowPlan, type: string, fallback: number): number {
  return plan.steps.find((step) => step.type === type)?.timeoutMs ?? fallback;
}

function publicDomain(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.username || url.password || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || isPrivateIp(hostname)) return undefined;
    return hostname;
  } catch { return undefined; }
}

function seedUrls(plan: WorkflowPlan, blockedDomains = plan.sourcePolicy.blockedDomains.map((domain) => domain.toLowerCase().replace(/^\*\./, "")), additional: string[] = [], stepType?: AgentExecutionInput["stepType"]): string[] {
  const candidates: string[] = [...additional];
  for (const step of plan.steps) {
    if (stepType && step.type !== stepType) continue;
    if (step.type !== "SCRAPE" && step.type !== "INTERACT") continue;
    if (typeof step.input.url === "string") candidates.push(step.input.url);
    if (Array.isArray(step.input.urls)) candidates.push(...step.input.urls.filter((url): url is string => typeof url === "string"));
  }
  return [...new Set(candidates.filter((url) => {
    const host = publicDomain(url);
    return host && !blockedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  }))].slice(0, plan.searchStrategy.maximumSourceCount);
}

function isPrivateIp(hostname: string): boolean {
  const version = isIP(hostname);
  if (version === 4) {
    const parts = hostname.split(".").map(Number);
    const [a = 0, b = 0] = parts;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0);
  }
  if (version === 6) {
    const value = hostname.toLowerCase();
    if (value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) return true;
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]!) : false;
  }
  return false;
}

function getProviderKey(config: AppConfig): string | undefined {
  return {
    google: config.GOOGLE_GENERATIVE_AI_API_KEY,
    anthropic: config.ANTHROPIC_API_KEY,
    openai: config.OPENAI_API_KEY,
    gateway: config.AI_GATEWAY_API_KEY,
    "custom-openai": config.CUSTOM_OPENAI_API_KEY,
  }[config.LLM_PROVIDER];
}

function secrets(config: AppConfig): string[] {
  return [config.FIRECRAWL_API_KEY, config.GOOGLE_GENERATIVE_AI_API_KEY, config.ANTHROPIC_API_KEY, config.OPENAI_API_KEY, config.AI_GATEWAY_API_KEY, config.CUSTOM_OPENAI_API_KEY]
    .filter((value): value is string => Boolean(value));
}

function redactSecrets(message: string, keys: string[]): string {
  let safe = message;
  for (const key of keys) if (key.length >= 6) safe = safe.split(key).join("[REDACTED]");
  return safe.replace(/(?:fc-[a-zA-Z0-9_-]{12,}|AIza[\w-]{20,}|AQ\.[\w-]{10,})/g, "[REDACTED]").slice(0, 500);
}

function withEvents(result: AgentResult, events: AgentExecutionEvent[]): AgentResult {
  return { ...result, events };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
