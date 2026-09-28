"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getAccessToken } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SSEEvent {
  id: string;
  action: string;
  data: Record<string, unknown>;
  timestamp?: string;
}

interface UseSSEOptions {
  /** API path to the SSE endpoint (relative to /api/v1). */
  path: string;
  /** Query parameters (workspaceId, userId, etc.). */
  query?: Record<string, string>;
  /** Whether to connect. Set false to defer connection. */
  enabled?: boolean;
  /** Called for every incoming event. */
  onEvent?: (event: SSEEvent) => void;
  /** Called when the stream closes (completed run). */
  onComplete?: () => void;
  /** Called on connection error. */
  onError?: (error: Event) => void;
}

interface UseSSEReturn {
  /** All events received so far. */
  events: SSEEvent[];
  /** Whether the EventSource is currently connected. */
  connected: boolean;
  /** Manually close the connection. */
  close: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * SSE hook for live workflow monitoring.
 *
 * Connects to the backend's Server-Sent Events endpoint and accumulates
 * events in state. Replaces the old `useWorkflowSimulation` timer hook.
 *
 * @example
 * const { events, connected } = useSSE({
 *   path: `/runs/${runId}/events`,
 *   query: { workspaceId, userId },
 *   enabled: !!runId,
 *   onEvent: (ev) => console.log(ev.action, ev.data),
 * });
 */
export function useSSE(options: UseSSEOptions): UseSSEReturn {
  const { path, query, enabled = true, onEvent, onComplete, onError } = options;

  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  // Keep callback refs stable
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const close = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Build URL
    const params = new URLSearchParams(query);
    const token = getAccessToken();
    if (token) params.set("token", token);

    const lastEvent = events.length > 0 ? events[events.length - 1] : null;
    if (lastEvent) params.set("lastEventId", lastEvent.id);

    const url = `/api/v1${path}?${params.toString()}`;

    const source = new EventSource(url);
    sourceRef.current = source;

    source.onopen = () => setConnected(true);

    source.onmessage = (messageEvent) => {
      try {
        const parsed: SSEEvent = JSON.parse(messageEvent.data);
        setEvents((prev) => [...prev, parsed]);
        onEventRef.current?.(parsed);

        // Terminal events — close the stream
        if (
          ["RUN_COMPLETED", "RUN_FAILED", "RUN_CANCELLED"].includes(parsed.action)
        ) {
          setTimeout(() => {
            close();
            onCompleteRef.current?.();
          }, 500);
        }
      } catch {
        // Ignore non-JSON messages (e.g., pings)
      }
    };

    // Also listen for named events the backend sends via `event:` field
    const KNOWN_EVENTS = [
      "STAGE_STARTED",
      "STAGE_COMPLETED",
      "RECORDS_COLLECTED",
      "SOURCE_DISCOVERED",
      "SOURCE_PROCESSED",
      "SOURCE_FAILED",
      "VALIDATION_COMPLETED",
      "DEDUP_COMPLETED",
      "DATASET_CREATED",
      "RUN_COMPLETED",
      "RUN_FAILED",
      "RUN_CANCELLED",
    ];

    for (const eventName of KNOWN_EVENTS) {
      source.addEventListener(eventName, (messageEvent) => {
        try {
          const parsed: SSEEvent = JSON.parse((messageEvent as MessageEvent).data);
          const enriched = { ...parsed, action: parsed.action || eventName };
          setEvents((prev) => [...prev, enriched]);
          onEventRef.current?.(enriched);

          if (["RUN_COMPLETED", "RUN_FAILED", "RUN_CANCELLED"].includes(eventName)) {
            setTimeout(() => {
              close();
              onCompleteRef.current?.();
            }, 500);
          }
        } catch {
          // Ignore
        }
      });
    }

    source.onerror = (err) => {
      setConnected(false);
      onErrorRef.current?.(err);
    };

    return () => {
      source.close();
      sourceRef.current = null;
      setConnected(false);
    };
  }, [path, enabled, JSON.stringify(query)]);

  return { events, connected, close };
}
