import pino from "pino";
import { describe, expect, it } from "vitest";
import { RateLimitService, type RateLimitRedis } from "../src/modules/sources/RateLimitService.js";
import { RetryPolicy } from "../src/modules/sources/RetryPolicy.js";
import { RobotsPolicyService, type RobotsFetch } from "../src/modules/sources/RobotsPolicyService.js";
import { SourcePolicyService } from "../src/modules/sources/SourcePolicyService.js";
import { SourceValidator } from "../src/modules/sources/SourceValidator.js";
import type { SourceExecutionPolicy, SourceLifecycleInput, SourceLifecycleStore, SourceLifecycleUpdate, SourcePolicyContext } from "../src/modules/sources/source-governance.types.js";
import type { WorkflowPlan } from "../src/modules/planner/workflow-plan.schema.js";

const validator = new SourceValidator();
const retryConfig: SourceExecutionPolicy = {
  maxAttempts: 3, backoff: "exponential" as const, initialDelayMs: 1, multiplier: 2, maxDelayMs: 5,
  retryableErrors: ["TIMEOUT", "RATE_LIMIT", "TRANSIENT_NETWORK", "SERVER_ERROR"],
};

describe("source governance", () => {
  it("allows matching allowlist domains and blocks denylist matches", () => {
    expect(validator.validate("https://jobs.example.org/opening", { allowedDomains: ["example.org"], blockedDomains: [] }).allowed).toBe(true);
    expect(validator.validate("https://sub.example.org/opening", { allowedDomains: ["example.org"], blockedDomains: [] }).allowed).toBe(true);
    expect(validator.validate("https://example.org/opening", { allowedDomains: [], blockedDomains: ["*.example.org"] })).toMatchObject({
      allowed: false, status: "BLOCKED", code: "DOMAIN_DENYLISTED",
    });
    expect(validator.validate("https://outside.net/opening", { allowedDomains: ["example.org"], blockedDomains: [] })).toMatchObject({
      allowed: false, code: "DOMAIN_NOT_ALLOWLISTED",
    });
  });

  it("fails closed when robots.txt disallows a path and honors the more specific allow rule", async () => {
    const robots = makeRobots("User-agent: *\nDisallow: /private\nAllow: /private/public\nCrawl-delay: 2");
    expect(await robots.check("https://example.org/private/item")).toMatchObject({ allowed: false, status: "DISALLOWED" });
    expect(await robots.check("https://example.org/private/public/item")).toMatchObject({ allowed: true, crawlDelayMs: 2_000 });
  });

  it("marks a source blocked with its robots reason and saves the check metadata", async () => {
    const store = new MemorySourceStore();
    const policy = makeSourcePolicy(store, makeRobots("User-agent: *\nDisallow: /private"));
    const result = await policy.execute({
      url: "https://example.org/private/record", sourceType: "scrape", context: testContext(), timeoutMs: 100,
      retryPolicy: retryConfig, operation: async () => ({ ok: true }),
    });
    expect(result).toMatchObject({ code: "ROBOTS_DISALLOW", sourceStatus: "BLOCKED" });
    expect([...store.sources.values()][0]?.update).toMatchObject({ status: "BLOCKED", robotsStatus: "DISALLOWED" });
    expect([...store.sources.values()][0]?.update.reason).toContain("robots.txt disallows");
  });

  it("fails closed on unavailable robots.txt and records the inaccessible status", async () => {
    const store = new MemorySourceStore();
    const unavailable = new RobotsPolicyService({ fetcher: async () => ({ status: 503, text: async () => "" }) });
    const policy = makeSourcePolicy(store, unavailable);
    const result = await policy.execute({
      url: "https://example.org/public/item", sourceType: "scrape", context: testContext(), timeoutMs: 100,
      retryPolicy: retryConfig, operation: async () => ({ ok: true }),
    });
    expect(result).toMatchObject({ code: "ROBOTS_UNAVAILABLE", sourceStatus: "SKIPPED" });
    expect([...store.sources.values()][0]?.update).toMatchObject({ status: "SKIPPED", robotsStatus: "UNAVAILABLE" });
  });

  it("stores blocked URLs without credentials or sensitive query values", async () => {
    const store = new MemorySourceStore();
    const policy = makeSourcePolicy(store, makeRobots(""));
    const result = await policy.execute({
      url: "https://user:secret@example.org/path?token=hidden", sourceType: "scrape", context: testContext(), timeoutMs: 100,
      retryPolicy: retryConfig, operation: async () => ({ ok: true }),
    });
    const persisted = [...store.sources.values()][0];
    expect(result).toMatchObject({ code: "URL_CREDENTIALS_BLOCKED", sourceStatus: "BLOCKED" });
    expect(persisted?.input.url).toBe("https://example.org/path");
    expect(JSON.stringify(persisted)).not.toContain("secret");
    expect(JSON.stringify(persisted)).not.toContain("hidden");
  });

  it("continues to a permitted alternative and records a collected source", async () => {
    const store = new MemorySourceStore();
    const policy = makeSourcePolicy(store, makeRobots("User-agent: *\nDisallow: /blocked"));
    const first = await policy.execute({
      url: "https://example.org/blocked/item", sourceType: "scrape", context: testContext(), timeoutMs: 100,
      retryPolicy: retryConfig, operation: async () => ({ ok: true }),
    });
    const alternative = await policy.execute({
      url: "https://example.org/public/item", sourceType: "scrape", context: testContext(), timeoutMs: 100,
      retryPolicy: retryConfig, operation: async () => ({ title: "Public source" }),
    });
    expect(first).toMatchObject({ sourceStatus: "BLOCKED" });
    expect(alternative).toEqual({ title: "Public source" });
    expect([...store.sources.values()].map(({ update }) => update.status)).toContain("COLLECTED");
  });

  it("enforces shared per-domain limits and robots crawl delay", async () => {
    const calls: Array<{ key: string; limit: string }> = [];
    const redis: RateLimitRedis = {
      eval: async (_script, _keyCount, key, _time, _window, limit) => {
        calls.push({ key: String(key), limit: String(limit) });
        return [0, 4_000];
      },
    };
    const decision = await new RateLimitService(redis, () => 12, () => "request-id").acquire("Example.org", 3, 60_000, 2_000);
    expect(decision).toEqual({ allowed: false, limit: 3, retryAfterMs: 4_000 });
    expect(calls[0]?.key).toMatch(/^aidp:source-rate:[a-f0-9]{64}$/);
  });

  it("times out a hung source operation", async () => {
    const retry = new RetryPolicy(async () => undefined, (base) => base);
    await expect(retry.execute(
      (signal) => new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
      { ...retryConfig, maxAttempts: 1, retryableErrors: [] },
      { timeoutMs: 5 },
    )).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("retries transient server errors with bounded exponential delay", async () => {
    const waits: number[] = [];
    const retry = new RetryPolicy(async (milliseconds) => { waits.push(milliseconds); }, (base) => base);
    let attempts = 0;
    const result = await retry.execute(async () => {
      attempts += 1;
      if (attempts < 3) throw { status: 503, message: "temporarily unavailable" };
      return "ok";
    }, retryConfig, { timeoutMs: 100 });
    expect(result).toEqual({ value: "ok", attempts: 3 });
    expect(waits).toEqual([1, 2]);
  });

  it("does not retry permanent HTTP errors", async () => {
    let attempts = 0;
    const retry = new RetryPolicy(async () => undefined, (base) => base);
    await expect(retry.execute(async () => {
      attempts += 1;
      throw { status: 403, message: "access denied" };
    }, retryConfig, { timeoutMs: 100 })).rejects.toThrow("access denied");
    expect(attempts).toBe(1);
  });

  it("deduplicates normalized source URLs and tracks repeated discoveries", async () => {
    const store = new MemorySourceStore();
    const policy = makeSourcePolicy(store, makeRobots(""));
    const first = await policy.discover("HTTPS://Example.org:443/jobs/?utm_source=search&b=2&a=1#open", testContext(), { title: "Jobs" });
    const second = await policy.discover("https://example.org/jobs?a=1&b=2", testContext(), { title: "Jobs results" });
    expect(first.canonicalUrl).toBe("https://example.org/jobs?a=1&b=2");
    expect(second.canonicalUrl).toBe(first.canonicalUrl);
    expect(store.sources.size).toBe(1);
    expect([...store.sources.values()][0]).toMatchObject({ update: { status: "ALLOWED" }, input: { title: "Jobs results" } });
  });

  it("rejects invalid, credentialed, and local URLs before collection", () => {
    expect(validator.normalize("file:///etc/passwd")).toMatchObject({ code: "UNSUPPORTED_SCHEME" });
    expect(validator.normalize("https://user:password@example.org/" )).toMatchObject({ code: "URL_CREDENTIALS_BLOCKED" });
    expect(validator.normalize("http://127.0.0.1/admin")).toMatchObject({ code: "NON_PUBLIC_HOST_BLOCKED" });
  });
});

function makeRobots(text: string): RobotsPolicyService {
  const fetcher: RobotsFetch = async () => ({ status: 200, text: async () => text });
  return new RobotsPolicyService({ fetcher, userAgent: "ScoutlyBot", cacheTtlMs: 100_000 });
}

function testContext(): SourcePolicyContext {
  return {
    workspaceId: "workspace-test",
    workflowRunId: "run-test",
    plan: {
      sourcePolicy: {
        allowedDomains: [], blockedDomains: [], maxRequestsPerDomainPerMinute: 8,
        respectRobotsTxt: true, respectSiteTerms: true,
      },
      steps: [],
    } as unknown as WorkflowPlan,
  };
}

function makeSourcePolicy(store: MemorySourceStore, robots: RobotsPolicyService): SourcePolicyService {
  const redis: RateLimitRedis = { eval: async () => [1, 0] };
  return new SourcePolicyService(validator, robots, new RateLimitService(redis), new RetryPolicy(async () => undefined, (base) => base), store, pino({ enabled: false }));
}

class MemorySourceStore implements SourceLifecycleStore {
  readonly sources = new Map<string, { id: string; input: SourceLifecycleInput; update: Partial<SourceLifecycleUpdate> }>();

  async upsertDiscovered(input: SourceLifecycleInput): Promise<{ id: string }> {
    const existing = this.sources.get(input.canonicalUrlHash);
    const id = existing?.id ?? `source-${this.sources.size + 1}`;
    this.sources.set(input.canonicalUrlHash, { id, input, update: existing?.update ?? { status: "DISCOVERED", attemptCount: 0 } });
    return { id };
  }

  async updateLifecycle(_workspaceId: string, _workflowRunId: string, hash: string, update: SourceLifecycleUpdate): Promise<void> {
    const existing = this.sources.get(hash);
    if (existing) this.sources.set(hash, { ...existing, update: { ...existing.update, ...update } });
  }
}
