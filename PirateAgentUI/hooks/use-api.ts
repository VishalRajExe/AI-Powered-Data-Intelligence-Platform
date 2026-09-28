"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";

// ---------------------------------------------------------------------------
// Generic data-fetching hook
// ---------------------------------------------------------------------------

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | Error | null;
  /** Manually trigger a re-fetch. */
  refetch: () => Promise<void>;
}

/**
 * Declarative data-fetching hook.
 *
 * @param path   API path (relative to /api/v1)
 * @param query  Query parameters
 * @param opts   Optional configuration
 *
 * @example
 * const { data, loading } = useApi<WorkflowList>("/workflows", { workspaceId, userId, limit: 20 });
 */
export function useApi<T>(
  path: string | null,
  query?: Record<string, string | number | boolean | undefined>,
  opts?: {
    /** Skip the initial fetch (e.g. waiting for a dependency). */
    skip?: boolean;
    /** Called when data is fetched successfully. */
    onSuccess?: (data: T) => void;
  },
): UseApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!opts?.skip && !!path);
  const [error, setError] = useState<ApiError | Error | null>(null);

  // Stable serialization of query for effect dependency
  const queryKey = query ? JSON.stringify(query) : "";
  const onSuccessRef = useRef(opts?.onSuccess);
  onSuccessRef.current = opts?.onSuccess;

  const fetch = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<T>(path, query);
      setData(result);
      onSuccessRef.current?.(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [path, queryKey]);

  useEffect(() => {
    if (opts?.skip || !path) {
      setLoading(false);
      return;
    }
    fetch();
  }, [fetch, opts?.skip, path]);

  return { data, loading, error, refetch: fetch };
}
