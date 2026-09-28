/**
 * Central API client for the PirateAgent backend.
 *
 * - Injects Bearer access-token on every request.
 * - Automatically attempts a silent refresh on 401 responses (once).
 * - Provides typed helpers: api.get, api.post, api.put, api.delete.
 * - All methods throw `ApiError` on non-2xx responses.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Backend base URL — proxied by Next.js rewrites in development. */
const BASE_URL = "/api/v1";

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

const TOKEN_KEY = "pirateagent:access_token";
const REFRESH_KEY = "pirateagent:refresh_token";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  status: number;
  code: string;
  body: unknown;

  constructor(status: number, code: string, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Internal fetch wrapper
// ---------------------------------------------------------------------------

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function attemptRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  try {
    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      clearTokens();
      return false;
    }

    const data = await response.json();
    setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    clearTokens();
    return false;
  }
}

async function request<T>(
  method: string,
  path: string,
  options?: {
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
    headers?: Record<string, string>;
    raw?: boolean; // return raw Response (for blob downloads)
  },
): Promise<T> {
  // Build URL with query params
  let url = `${BASE_URL}${path}`;
  if (options?.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null && value !== "") {
        params.set(key, String(value));
      }
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  // Build headers
  const headers: Record<string, string> = {
    ...options?.headers,
  };
  const token = getAccessToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (options?.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  // Make the request
  let response = await fetch(url, {
    method,
    headers,
    body: options?.body
      ? options.body instanceof FormData
        ? options.body
        : JSON.stringify(options.body)
      : undefined,
  });

  // 401 → attempt silent token refresh (once)
  if (response.status === 401 && getRefreshToken()) {
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = attemptRefresh().finally(() => {
        isRefreshing = false;
        refreshPromise = null;
      });
    }

    const refreshed = await refreshPromise;
    if (refreshed) {
      // Retry the original request with the new token
      const newToken = getAccessToken();
      if (newToken) headers["Authorization"] = `Bearer ${newToken}`;
      response = await fetch(url, {
        method,
        headers,
        body: options?.body
          ? options.body instanceof FormData
            ? options.body
            : JSON.stringify(options.body)
          : undefined,
      });
    }
  }

  // Return raw response for blob downloads
  if (options?.raw) {
    if (!response.ok) {
      throw new ApiError(response.status, "REQUEST_FAILED", response.statusText);
    }
    return response as unknown as T;
  }

  // Parse JSON response
  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const errPayload = body as {
      error?: { code?: string; message?: string } | string;
      message?: string;
    } | null;
    const errObj = errPayload?.error;
    const code = typeof errObj === "string" ? errObj : errObj?.code ?? "REQUEST_FAILED";
    const msg =
      (typeof errObj === "object" && errObj?.message) ||
      errPayload?.message ||
      (typeof errObj === "string" ? errObj : null) ||
      response.statusText;
    throw new ApiError(response.status, code, msg, body);
  }

  // 204 No Content
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

type QueryParams = Record<string, string | number | boolean | undefined>;

export const api = {
  get<T>(path: string, query?: QueryParams) {
    return request<T>("GET", path, { query });
  },

  post<T>(path: string, body?: unknown, query?: QueryParams) {
    return request<T>("POST", path, { body, query });
  },

  put<T>(path: string, body?: unknown, query?: QueryParams) {
    return request<T>("PUT", path, { body, query });
  },

  patch<T>(path: string, body?: unknown, query?: QueryParams) {
    return request<T>("PATCH", path, { body, query });
  },

  delete<T>(path: string, query?: QueryParams) {
    return request<T>("DELETE", path, { query });
  },

  /** Get a raw Response object (e.g., for file downloads). */
  download(path: string, query?: QueryParams) {
    return request<Response>("GET", path, { query, raw: true });
  },
};
