"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";

/**
 * A read of live backend state: loading, then either data or the error that replaced it.
 *
 * There is no cached value carried across a failure. When a read fails, `data` goes back to null,
 * because a screen showing yesterday's rows beside today's error would be presenting a number the
 * caller cannot tell the age of — which is the same class of problem the rebuild removed the demo
 * layer for.
 */
export interface LiveState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** True once at least one read has finished, whether or not it produced data. */
  settled: boolean;
  reload: () => void;
}

export function useLive<T>(load: (signal?: AbortSignal) => Promise<T>): LiveState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [settled, setSettled] = useState(false);
  const [nonce, setNonce] = useState(0);
  const generation = useRef(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const mine = ++generation.current;
    setLoading(true);

    load(controller.signal)
      .then((result) => {
        if (generation.current !== mine) return;
        setData(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (generation.current !== mine) return;
        setData(null);
        setError(
          cause instanceof ApiError
            ? cause
            : new ApiError(cause instanceof Error ? cause.message : "Unknown failure", {
                code: "UNEXPECTED",
              })
        );
      })
      .finally(() => {
        if (generation.current !== mine) return;
        setLoading(false);
        setSettled(true);
      });

    return () => {
      controller.abort();
    };
  }, [load, nonce]);

  return { data, error, loading, settled, reload };
}
