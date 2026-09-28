import type { Request, Response, NextFunction, RequestHandler } from "express";

export interface RateLimiterOptions {
  windowMs?: number;
  maxRequests?: number;
  keyGenerator?: (req: Request, res: Response) => string;
  message?: string;
  code?: string;
}

interface RateLimitRecord {
  timestamps: number[];
}

export class MemoryRateLimiter {
  private readonly hits = new Map<string, RateLimitRecord>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly windowMs = 60_000,
    private readonly maxRequests = 100,
  ) {
    // Schedule periodic sweep of expired records every windowMs
    this.cleanupTimer = setInterval(() => this.cleanup(), Math.max(windowMs, 10_000));
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  check(key: string, now = Date.now()): { allowed: boolean; remaining: number; resetMs: number; retryAfterSeconds: number } {
    const threshold = now - this.windowMs;
    const record = this.hits.get(key) ?? { timestamps: [] };
    
    // Purge timestamps older than window
    const valid = record.timestamps.filter((ts) => ts > threshold);

    if (valid.length >= this.maxRequests) {
      const oldestValid = valid[0] ?? threshold;
      const resetMs = oldestValid + this.windowMs - now;
      const retryAfterSeconds = Math.max(1, Math.ceil(resetMs / 1000));
      return {
        allowed: false,
        remaining: 0,
        resetMs,
        retryAfterSeconds,
      };
    }

    valid.push(now);
    this.hits.set(key, { timestamps: valid });

    const oldest = valid[0] ?? now;
    const resetMs = oldest + this.windowMs - now;
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - valid.length),
      resetMs,
      retryAfterSeconds: 0,
    };
  }

  reset(): void {
    this.hits.clear();
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.hits.clear();
  }

  private cleanup(): void {
    const threshold = Date.now() - this.windowMs;
    for (const [key, record] of this.hits.entries()) {
      const valid = record.timestamps.filter((ts) => ts > threshold);
      if (valid.length === 0) {
        this.hits.delete(key);
      } else {
        record.timestamps = valid;
      }
    }
  }
}

export function createRateLimiter(options: RateLimiterOptions = {}): RequestHandler {
  const windowMs = options.windowMs ?? 60_000;
  const maxRequests = options.maxRequests ?? 100;
  const code = options.code ?? "TOO_MANY_REQUESTS";
  const message = options.message ?? "Rate limit exceeded. Please try again later.";
  const keyGen = options.keyGenerator ?? defaultKeyGenerator;

  const limiter = new MemoryRateLimiter(windowMs, maxRequests);

  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip rate-limiting for test runs unless explicitly enabled
    if ((process.env.NODE_ENV === "test" || process.env.APP_ENV === "test") && !process.env.TEST_RATE_LIMITS) {
      return next();
    }

    const key = keyGen(req, res);
    const result = limiter.check(key);

    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", result.remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil((Date.now() + result.resetMs) / 1000));

    if (!result.allowed) {
      res.setHeader("Retry-After", result.retryAfterSeconds);
      res.status(429).json({
        error: {
          code,
          message,
          retryAfterSeconds: result.retryAfterSeconds,
        },
      });
      return;
    }

    next();
  };
}

function defaultKeyGenerator(req: Request, res: Response): string {
  // Use authenticated user ID if present; otherwise fall back to client IP
  const user = res.locals.user as { id?: string } | undefined;
  if (user?.id) return `user:${user.id}`;
  const forwarded = req.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : req.ip || req.socket.remoteAddress || "unknown-ip";
  return `ip:${ip}`;
}

/**
 * Strict rate limiter for sensitive authentication endpoints (prevent brute-force).
 * 15 requests per 60 seconds per IP.
 */
export const authRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 15,
  message: "Too many authentication attempts. Please try again later.",
  code: "AUTH_RATE_LIMIT_EXCEEDED",
});

/**
 * Rate limiter for heavy LLM planning / requirement parsing / execution endpoints.
 * 30 requests per 60 seconds per user/IP.
 */
export const workflowRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 30,
  message: "Workflow operation rate limit exceeded. Please try again later.",
  code: "WORKFLOW_RATE_LIMIT_EXCEEDED",
});

/**
 * General API rate limiter.
 * 300 requests per 60 seconds.
 */
export const apiRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 300,
  message: "API rate limit exceeded. Please try again later.",
  code: "TOO_MANY_REQUESTS",
});
