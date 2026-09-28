import type { SourceExecutionPolicy, RetryableErrorCode } from "./source-governance.types.js";

export interface RetryExecutionOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  onAttempt?: (attempt: number) => void | Promise<void>;
}

export interface RetryExecutionResult<T> { value: T; attempts: number; }

export class SourceOperationError extends Error {
  constructor(readonly code: string, message: string, readonly retryable: boolean, readonly retryAfterMs?: number) {
    super(message);
    this.name = "SourceOperationError";
  }
}

export class RetryPolicy {
  constructor(
    private readonly wait: (delayMs: number, signal?: AbortSignal) => Promise<void> = delay,
    private readonly jitter: (baseDelayMs: number) => number = (base) => Math.round(base * (0.8 + Math.random() * 0.4)),
  ) {}

  async execute<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    policy: SourceExecutionPolicy,
    options: RetryExecutionOptions,
  ): Promise<RetryExecutionResult<T>> {
    let lastError: unknown;
    const maxAttempts = Math.max(1, policy.maxAttempts);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (options.signal?.aborted) throw new SourceOperationError("CANCELLED", "Source operation was cancelled.", false);
      await options.onAttempt?.(attempt);
      const controller = new AbortController();
      const onAbort = (): void => controller.abort(options.signal?.reason);
      options.signal?.addEventListener("abort", onAbort, { once: true });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const work = operation(controller.signal);
        const timedOut = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(new SourceOperationError("TIMEOUT", `Source request exceeded ${options.timeoutMs}ms.`, true));
            controller.abort(new Error("Source request timed out"));
          }, options.timeoutMs);
          timeout.unref?.();
        });
        const value = await Promise.race([work, timedOut]);
        if (hasToolFailure(value)) throw classifyToolFailure(value);
        return { value, attempts: attempt };
      } catch (error) {
        lastError = normalizeError(error);
        const code = classifyRetryableError(lastError);
        const retryable = lastError instanceof SourceOperationError ? lastError.retryable : code !== undefined;
        const allowedByPolicy = code !== undefined && policy.retryableErrors.includes(code);
        if (!retryable || !allowedByPolicy || attempt >= maxAttempts || policy.backoff === "none") throw lastError;
        const exponential = Math.min(policy.maxDelayMs, policy.initialDelayMs * policy.multiplier ** (attempt - 1));
        await this.wait(Math.max(this.jitter(exponential), lastError instanceof SourceOperationError ? lastError.retryAfterMs ?? 0 : 0), options.signal);
      } finally {
        if (timeout) clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onAbort);
      }
    }
    throw normalizeError(lastError);
  }
}

export function classifyRetryableError(error: unknown): RetryableErrorCode | undefined {
  if (error instanceof SourceOperationError) return error.code as RetryableErrorCode;
  const record = asRecord(error);
  const name = typeof record.name === "string" ? record.name : "";
  const message = error instanceof Error ? error.message : String(record.message ?? error ?? "");
  const status = Number(record.statusCode ?? record.status ?? asRecord(record.response).status);
  if (name === "TimeoutError" || name === "AbortError" || /timed?\s*out|timeout/i.test(message)) return "TIMEOUT";
  if (status === 429 || status === 408 || status === 425) return "RATE_LIMIT";
  if (status >= 500 && status <= 599) return "SERVER_ERROR";
  if (/network|socket|fetch failed|econnreset|eai_again|connection/i.test(message)) return "TRANSIENT_NETWORK";
  return undefined;
}

function hasToolFailure(value: unknown): boolean {
  const record = asRecord(value);
  return typeof record.error === "string" || record.success === false || record.ok === false;
}

function classifyToolFailure(value: unknown): SourceOperationError {
  const record = asRecord(value);
  const response = asRecord(record.response);
  const status = Number(record.statusCode ?? record.status ?? response.status);
  const raw = record.error;
  const message = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : "Source tool reported a failed response.";
  const code = classifyRetryableError({ status, message });
  return new SourceOperationError(code ?? "SOURCE_REQUEST_FAILED", message.slice(0, 500), code !== undefined);
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : "Source request failed.";
    const code = classifyRetryableError(error);
    return new SourceOperationError(code ?? "SOURCE_REQUEST_FAILED", message, code !== undefined);
  }
  return new SourceOperationError("SOURCE_REQUEST_FAILED", "Source request failed.", false);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function delay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new SourceOperationError("CANCELLED", "Source retry was cancelled.", false));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, delayMs);
    const abort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new SourceOperationError("CANCELLED", "Source retry was cancelled.", false));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
