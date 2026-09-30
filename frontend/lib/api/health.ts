import { ApiError, apiRequest } from "./client";
import type { HealthResponse, ReadinessResponse } from "./types";

/**
 * The only backend read performed in Phase 1. The Python AI service is reached through
 * the backend in later phases, never from the browser.
 */

export interface EndpointReport<T> {
  /** Parsed body, or null when the endpoint did not answer with usable JSON. */
  data: T | null;
  /** HTTP status as observed; null when the request never reached the backend. */
  httpStatus: number | null;
  /**
   * True only when a JSON document actually came back. The Next.js proxy answers 500 with
   * plain text when nothing is listening on `BACKEND_ORIGIN`, and that is not a backend reply.
   */
  answered: boolean;
  /** Transport / parse failure, or an error envelope from the backend. */
  error: ApiError | null;
}

export interface BackendStatusReport {
  health: EndpointReport<HealthResponse>;
  readiness: EndpointReport<ReadinessResponse>;
  /** True when at least one endpoint returned a readable JSON document. */
  backendReached: boolean;
  /** Browser-clock time the probe started, shown as "last checked". */
  checkedAt: string;
}

async function probe<T>(
  path: string,
  acceptStatuses: number[],
  signal?: AbortSignal,
  timeoutMs?: number
): Promise<EndpointReport<T>> {
  try {
    const result = await apiRequest<T>(path, { signal, timeoutMs, acceptStatuses });
    if (!result.ok) {
      const envelope = result.envelope;
      return {
        data: null,
        httpStatus: result.status,
        answered: result.jsonParsed,
        error: new ApiError(envelope?.error?.message ?? `HTTP ${result.status}`, {
          status: result.status,
          code: envelope?.error?.code ?? "HTTP_ERROR",
          body: envelope ?? null,
          path,
        }),
      };
    }
    return { data: result.data, httpStatus: result.status, answered: result.jsonParsed, error: null };
  } catch (cause) {
    const error =
      cause instanceof ApiError
        ? cause
        : new ApiError(cause instanceof Error ? cause.message : "Unknown failure", {
            code: "UNEXPECTED",
            path,
          });
    return { data: null, httpStatus: error.status || null, answered: false, error };
  }
}

/**
 * Calls `GET /api/v1/health` and `GET /api/v1/ready` in parallel.
 * Never throws and never substitutes values: every field it returns is either observed
 * from the backend or explicitly null so the caller can render "unavailable".
 */
export async function fetchBackendStatus(options: {
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): Promise<BackendStatusReport> {
  const checkedAt = new Date().toISOString();

  const [health, readiness] = await Promise.all([
    probe<HealthResponse>("/health", [200], options.signal, options.timeoutMs),
    // 503 is the documented "not ready" answer and still carries the full report.
    probe<ReadinessResponse>("/ready", [200, 503], options.signal, options.timeoutMs),
  ]);

  return {
    health,
    readiness,
    // Deliberately keyed on a readable JSON body, not on the HTTP status: the Next.js proxy
    // answers 500/plain-text when nothing is listening on BACKEND_ORIGIN, and that is not
    // the backend reporting a state.
    backendReached: health.answered || readiness.answered,
    checkedAt,
  };
}
