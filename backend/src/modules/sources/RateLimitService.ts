import { createHash } from "node:crypto";

export interface RateLimitRedis {
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  retryAfterMs: number;
}

const slidingWindowScript = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local minIntervalMs = tonumber(ARGV[5])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)
local count = redis.call('ZCARD', key)
local retryAfter = 0
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  retryAfter = math.max(retryAfter, tonumber(oldest[2]) + windowMs - now)
end
if count > 0 and minIntervalMs > 0 then
  local latest = redis.call('ZREVRANGE', key, 0, 0, 'WITHSCORES')
  retryAfter = math.max(retryAfter, tonumber(latest[2]) + minIntervalMs - now)
end
if retryAfter > 0 then
  return {0, retryAfter}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, windowMs + 1000)
return {1, 0}
`;

export class RateLimitService {
  constructor(
    private readonly redis: RateLimitRedis,
    private readonly now: () => number = Date.now,
    private readonly requestId: () => string = () => `${Math.random().toString(36).slice(2)}-${Date.now()}`,
  ) {}

  async acquire(domain: string, limit: number, windowMs = 60_000, minIntervalMs = 0): Promise<RateLimitDecision> {
    const normalizedDomain = domain.toLowerCase().replace(/\.$/, "");
    const digest = createHash("sha256").update(normalizedDomain).digest("hex");
    const raw = await this.redis.eval(
      slidingWindowScript,
      1,
      `aidp:source-rate:${digest}`,
      this.now(),
      windowMs,
      limit,
      this.requestId(),
      minIntervalMs,
    );
    if (!Array.isArray(raw) || raw.length < 2) throw new Error("Redis returned an invalid source rate-limit decision");
    return { allowed: Number(raw[0]) === 1, limit, retryAfterMs: Number(raw[1]) };
  }
}
