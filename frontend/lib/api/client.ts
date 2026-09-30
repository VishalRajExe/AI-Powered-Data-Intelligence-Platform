import type { ErrorEnvelope } from "./types";

/**
 * Same-origin fetch wrapper for the backend API.
 *
 * Deliberately contains no auth: no tokens, no headers of the kind, no localStorage.
 * Requests go to `/api/v1/*`, which `next.config.js` proxies to the server-side
 * `BACKEND_ORIGIN`; the browser never learns the backend's real origin.
 *
 * The session credential is an `HttpOnly` cookie the server set, so nothing here reads, writes or
 * sends it — `credentials: "same-origin"` lets the browser attach it. A mutating request adds
 * `X-Requested-With`, which is the header the backend's state-change filter demands in place of a
 * CSRF token.
 */

const API_BASE = "/api/v1";

/** Default per-request budget. Health checks should fail fast rather than hang a page. */
export const DEFAULT_TIMEOUT_MS = 8000;

/**
 * The header the backend's state-change filter requires on every mutating request. It replaces
 * Spring Security's double-submit token, which cannot work while the browser is given no readable
 * token at all — see `SecurityConfig`'s class comment. Presence is checked, not value.
 */
const STATE_CHANGE_HEADER = "X-Requested-With";

export class ApiError extends Error {
  /** HTTP status, or 0 when the request never reached the backend. */
  readonly status: number;
  /** Stable machine code: the backend's `error.code`, else a client-side fallback. */
  readonly code: string;
  /** Parsed backend envelope, preserved verbatim for display/debugging. */
  readonly body: ErrorEnvelope | null;
  readonly path: string;

  constructor(
    message: string,
    init: { status?: number; code?: string; body?: ErrorEnvelope | null; path?: string } = {}
  ) {
    super(message);
    this.name = "ApiError";
    this.status = init.status ?? 0;
    this.code = init.code ?? "UNKNOWN_ERROR";
    this.body = init.body ?? null;
    this.path = init.path ?? "";
  }
}

export const ERROR_CODE = {
  TIMEOUT: "TIMEOUT",
  ABORTED: "ABORTED",
  NETWORK: "NETWORK",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  HTTP_ERROR: "HTTP_ERROR",
} as const;

function joinPath(path: string, query?: Record<string, string | number | boolean | undefined>) {
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/** Repeated query clauses (`filter=a:eq:1&filter=b:present`) survive as a list instead of collapsing. */
function joinPathWithLists(
  path: string,
  query?: Record<string, string | number | boolean | undefined | (string | number)[]>
) {
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, String(entry));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/** Links an optional caller signal to an internal timeout signal. */
function withTimeout(external?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;

  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;

  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      if (timer) clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}

interface RawResult<T> {
  status: number;
  ok: boolean;
  data: T | null;
  envelope: ErrorEnvelope | null;
  /** True only when the response body parsed as JSON — i.e. something answered *as the backend*. */
  jsonParsed: boolean;
}

/**
 * One transport for both verbs. Every failure leaves as a structured result rather than an
 * exception so `apiRequest` can keep treating a documented non-2xx as data.
 */
async function perform<T>(
  url: string,
  path: string,
  init: RequestInit,
  options: { signal?: AbortSignal; timeoutMs?: number; acceptStatuses?: number[] }
): Promise<RawResult<T>> {
  const timeout = withTimeout(options.signal, options.timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      signal: timeout.signal,
    });
  } catch (cause) {
    if (timeout.timedOut()) {
      throw new ApiError(`Request to ${url} timed out.`, {
        code: ERROR_CODE.TIMEOUT,
        path,
        body: { error: { code: ERROR_CODE.TIMEOUT, message: `Request to ${url} timed out.` } },
      });
    }
    if (cause instanceof DOMException && cause.name === "AbortError") {
      throw new ApiError(`Request to ${url} was cancelled.`, {
        code: ERROR_CODE.ABORTED,
        path,
        body: { error: { code: ERROR_CODE.ABORTED, message: `Request to ${url} was cancelled.` } },
      });
    }
    throw new ApiError(`Could not reach the backend at ${url}.`, {
      code: ERROR_CODE.NETWORK,
      path,
      body: { error: { code: ERROR_CODE.NETWORK, message: `Could not reach the backend at ${url}.` } },
    });
  } finally {
    timeout.dispose();
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  const accepted = options.acceptStatuses?.includes(response.status) ?? false;
  const jsonParsed = parsed !== null && typeof parsed === "object";

  if (!response.ok && !accepted) {
    const envelope = (jsonParsed ? (parsed as ErrorEnvelope) : null) ?? {
      error: {
        code: ERROR_CODE.HTTP_ERROR,
        message: text.trim() || `HTTP ${response.status}`,
      },
    };
    return { status: response.status, ok: false, data: null, envelope, jsonParsed };
  }

  if (!jsonParsed && text.trim().length > 0) {
    throw new ApiError(`Backend returned a non-JSON body for ${url}.`, {
      status: response.status,
      code: ERROR_CODE.INVALID_RESPONSE,
      path,
      body: {
        error: {
          code: ERROR_CODE.INVALID_RESPONSE,
          message: `Backend returned a non-JSON body for ${url}.`,
        },
      },
    });
  }

  return {
    status: response.status,
    ok: response.ok || accepted,
    data: parsed as T,
    envelope: null,
    jsonParsed,
  };
}

/**
 * Performs a GET and returns the parsed body without throwing on non-2xx.
 * `/ready` answers 503 with a real report, so `acceptStatuses` lets a caller treat a
 * documented failure code as data instead of an exception.
 */
export async function apiRequest<T>(
  path: string,
  options: {
    query?: Record<string, string | number | boolean | undefined>;
    signal?: AbortSignal;
    timeoutMs?: number;
    /** Status codes that carry a meaningful body rather than an error (e.g. 503 readiness). */
    acceptStatuses?: number[];
  } = {}
): Promise<RawResult<T>> {
  const url = joinPath(path, options.query);
  return perform<T>(url, path, { method: "GET", headers: { Accept: "application/json" } }, options);
}

/** Strict GET: throws `ApiError` carrying the backend envelope on any failure. */
export async function apiGet<T>(
  path: string,
  options: {
    query?: Record<string, string | number | boolean | undefined | (string | number)[]>;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const url = joinPathWithLists(path, options.query);
  const result = await perform<T>(
    url,
    path,
    { method: "GET", headers: { Accept: "application/json" } },
    options
  );
  return unwrap(result, path);
}

/** POST a JSON body. The state-change header is always sent; a caller cannot forget it. */
export async function apiPost<T>(
  path: string,
  body?: unknown,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<T> {
  const url = joinPath(path);
  const headers: Record<string, string> = {
    Accept: "application/json",
    [STATE_CHANGE_HEADER]: "fetch",
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
  };
  const result = await perform<T>(
    url,
    path,
    { method: "POST", headers, body: body === undefined ? null : JSON.stringify(body) },
    options
  );
  return unwrap(result, path);
}

function unwrap<T>(result: RawResult<T>, path: string): T {
  if (!result.ok) {
    throw new ApiError(result.envelope?.error?.message ?? `HTTP ${result.status}`, {
      status: result.status,
      code: result.envelope?.error?.code ?? ERROR_CODE.HTTP_ERROR,
      body: result.envelope,
      path,
    });
  }
  return result.data as T;
}
