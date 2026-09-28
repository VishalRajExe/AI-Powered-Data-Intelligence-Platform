import { createHash } from "node:crypto";
import type { Logger } from "pino";
import type { SourceValidator } from "./SourceValidator.js";
import type { RobotsPolicyService } from "./RobotsPolicyService.js";
import type { RateLimitService } from "./RateLimitService.js";
import { SourceOperationError } from "./RetryPolicy.js";
import type { RetryPolicy } from "./RetryPolicy.js";
import type { SourceLifecycleStore, SourcePolicyContext, SourceExecutionPolicy, SourceDecision } from "./source-governance.types.js";

export interface GovernedSourceCall {
  url: string;
  sourceType: "search" | "scrape" | "interact";
  title?: string;
  snippet?: string;
  context: SourcePolicyContext;
  timeoutMs: number;
  retryPolicy: SourceExecutionPolicy;
  operation(signal: AbortSignal): Promise<unknown>;
  signal?: AbortSignal;
}

export class SourcePolicyService {
  constructor(
    private readonly validator: SourceValidator,
    private readonly robots: RobotsPolicyService,
    private readonly rateLimits: RateLimitService,
    private readonly retries: RetryPolicy,
    private readonly store: SourceLifecycleStore,
    private readonly logger: Logger,
  ) {}

  async discover(url: string, context: SourcePolicyContext, metadata: { title?: string; snippet?: string } = {}): Promise<SourceDecision> {
    const rules = {
      allowedDomains: context.plan.sourcePolicy.allowedDomains,
      blockedDomains: context.plan.sourcePolicy.blockedDomains,
    };
    const decision = this.validator.validate(url, rules);
    const normalized = this.validator.normalize(url);
    const canonicalUrl = "error" in normalized ? decision.canonicalUrl : normalized.canonicalUrl;
    const domain = "error" in normalized ? decision.domain : normalized.domain;
    const hash = "error" in normalized ? stableHash(canonicalUrl) : normalized.hash;
    await this.store.upsertDiscovered({
      workspaceId: context.workspaceId, workflowRunId: context.workflowRunId,
      url: this.validator.safeUrl(url), canonicalUrl, canonicalUrlHash: hash, domain,
      ...(metadata.title ? { title: metadata.title.slice(0, 512) } : {}),
      metadata: {
        sourceType: "search",
        ...(metadata.snippet ? { snippet: metadata.snippet.slice(0, 1_000) } : {}),
      },
    });
    if (decision.status !== "ALLOWED") {
      await this.store.updateLifecycle(context.workspaceId, context.workflowRunId, hash, {
        status: decision.status, ...(decision.code ? { code: decision.code } : {}), reason: decision.reason,
      });
      this.logger.info({ workflowRunId: context.workflowRunId, domain, code: decision.code }, "Discovered source was excluded by policy");
      return decision;
    }
    await this.store.updateLifecycle(context.workspaceId, context.workflowRunId, hash, {
      status: "ALLOWED", reason: decision.reason,
    });
    return decision;
  }

  async execute(call: GovernedSourceCall): Promise<unknown> {
    const { context } = call;
    const rules = { allowedDomains: context.plan.sourcePolicy.allowedDomains, blockedDomains: context.plan.sourcePolicy.blockedDomains };
    const decision = this.validator.validate(call.url, rules);
    const normalized = this.validator.normalize(call.url);
    if ("error" in normalized) {
      const safeUrl = this.validator.safeUrl(call.url);
      const safeHash = stableHash(safeUrl);
      await this.store.upsertDiscovered({
        workspaceId: context.workspaceId, workflowRunId: context.workflowRunId,
        url: safeUrl, canonicalUrl: decision.canonicalUrl, canonicalUrlHash: safeHash, domain: decision.domain,
        metadata: { sourceType: call.sourceType },
      });
      await this.persistStatus(context, safeHash, "BLOCKED", decision.code, decision.reason);
      return { error: decision.reason, code: decision.code, sourceStatus: "BLOCKED" };
    }

    await this.store.upsertDiscovered({
      workspaceId: context.workspaceId,
      workflowRunId: context.workflowRunId,
      url: normalized.canonicalUrl,
      canonicalUrl: normalized.canonicalUrl,
      canonicalUrlHash: normalized.hash,
      domain: normalized.domain,
      ...(call.title ? { title: call.title.slice(0, 512) } : {}),
      metadata: { sourceType: call.sourceType, ...(call.snippet ? { snippet: call.snippet.slice(0, 1_000) } : {}) },
    });
    if (!decision.allowed) {
      await this.persistStatus(context, normalized.hash, "BLOCKED", decision.code, decision.reason);
      this.logger.info({ workflowRunId: context.workflowRunId, domain: normalized.domain, code: decision.code }, "Source collection blocked by policy");
      return { error: decision.reason, code: decision.code, sourceStatus: "BLOCKED" };
    }

    await this.persistStatus(context, normalized.hash, "ALLOWED", undefined, decision.reason);
    let robots;
    try { robots = await this.robots.check(normalized.canonicalUrl); }
    catch {
      await this.persistStatus(context, normalized.hash, "SKIPPED", "ROBOTS_UNAVAILABLE", "robots.txt could not be checked; source access fails closed.");
      return { error: "robots.txt could not be checked; source access fails closed.", code: "ROBOTS_UNAVAILABLE", sourceStatus: "SKIPPED" };
    }
    await this.store.updateLifecycle(context.workspaceId, context.workflowRunId, normalized.hash, {
      status: robots.allowed ? "ALLOWED" : robots.status === "DISALLOWED" ? "BLOCKED" : "SKIPPED",
      robotsStatus: robots.status,
      robotsCheckedAt: robots.checkedAt,
      ...(robots.allowed ? { reason: robots.reason } : {
        code: robots.status === "DISALLOWED" ? "ROBOTS_DISALLOW" : "ROBOTS_UNAVAILABLE",
        reason: robots.reason,
      }),
    });
    if (!robots.allowed) {
      this.logger.info({ workflowRunId: context.workflowRunId, domain: normalized.domain, robotsStatus: robots.status }, "Source excluded by robots policy");
      return {
        error: robots.reason,
        code: robots.status === "DISALLOWED" ? "ROBOTS_DISALLOW" : "ROBOTS_UNAVAILABLE",
        sourceStatus: robots.status === "DISALLOWED" ? "BLOCKED" : "SKIPPED",
      };
    }

    await this.persistStatus(context, normalized.hash, "QUEUED", undefined, "Source passed domain and robots checks; request is awaiting collection.");
    await this.persistStatus(context, normalized.hash, "PROCESSING", undefined, "Source request is in progress.");
    try {
      const result = await this.retries.execute(async (signal) => {
        let rateLimit;
        try {
          rateLimit = await this.rateLimits.acquire(
            normalized.domain,
            context.plan.sourcePolicy.maxRequestsPerDomainPerMinute,
            60_000,
            robots.crawlDelayMs ?? 0,
          );
        } catch {
          throw new SourceOperationError("RATE_LIMIT_UNAVAILABLE", "Source rate limiter is unavailable; collection fails closed.", false);
        }
        if (!rateLimit.allowed) {
          throw new SourceOperationError("RATE_LIMIT", "Per-domain request limit reached.", true, rateLimit.retryAfterMs);
        }
        return call.operation(signal);
      }, call.retryPolicy, {
        timeoutMs: call.timeoutMs,
        ...(call.signal ? { signal: call.signal } : {}),
        onAttempt: async (attempt) => this.store.updateLifecycle(context.workspaceId, context.workflowRunId, normalized.hash, {
          status: "PROCESSING", attemptCount: attempt, attemptedAt: new Date(),
        }),
      });
      await this.store.updateLifecycle(context.workspaceId, context.workflowRunId, normalized.hash, {
        status: "COLLECTED", retrievedAt: new Date(), reason: null, code: null,
        metadata: { sourceType: call.sourceType, attemptCount: result.attempts, robotsStatus: robots.status },
      });
      return result.value;
    } catch (error) {
      const sourceError = error instanceof Error ? error : new SourceOperationError("SOURCE_REQUEST_FAILED", "Source request failed.", false);
      const code = sourceError instanceof SourceOperationError ? sourceError.code : "SOURCE_REQUEST_FAILED";
      const skipped = code === "RATE_LIMIT" || code === "RATE_LIMIT_UNAVAILABLE";
      const safeMessage = sanitizeErrorMessage(sourceError.message, this.validator);
      await this.persistStatus(context, normalized.hash, skipped ? "SKIPPED" : "FAILED", code, safeMessage);
      this.logger.warn({ workflowRunId: context.workflowRunId, domain: normalized.domain, errorName: sourceError.name }, "Source collection failed");
      return { error: safeMessage, code, sourceStatus: skipped ? "SKIPPED" : "FAILED" };
    }
  }

  private persistStatus(context: SourcePolicyContext, hash: string, status: "BLOCKED" | "SKIPPED" | "ALLOWED" | "QUEUED" | "PROCESSING" | "FAILED", code?: string, reason?: string) {
    return this.store.updateLifecycle(context.workspaceId, context.workflowRunId, hash, {
      status, ...(code ? { code } : {}), ...(reason ? { reason } : {}),
    });
  }
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizeErrorMessage(message: string, validator: SourceValidator): string {
  return message
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => validator.safeUrl(url))
    .replace(/(?:fc-[a-zA-Z0-9_-]{12,}|AIza[\w-]{20,}|AQ\.[\w-]{10,})/g, "[REDACTED]")
    .slice(0, 500);
}
