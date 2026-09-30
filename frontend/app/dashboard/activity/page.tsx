"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ShipWheelIcon, NauticalInstrumentIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { ReadError } from "@/components/common/read-error";
import { operations } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/client";
import { formatNumber, plural } from "@/lib/utils";
import type { ActivityEvent, MonitoringResponse } from "@/lib/api/types";

const PAGE = 50;
const POLL_MS = 5000;

/**
 * The durable event log.
 *
 * The cursor is an event id, not a timestamp: ids increase with the log, so two writers rounding to
 * the same second cannot make this skip or repeat an event. Reads are polled every{" "}
 * {POLL_MS / 1000}s rather than pushed — the stream endpoint is still open work (P63), and a poll
 * over the same rows is honest where an invented push would not be.
 */
export default function ActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [action, setAction] = useState("");
  const [applied, setApplied] = useState("");
  const [polling, setPolling] = useState(true);
  const [more, setMore] = useState(false);
  const generation = useRef(0);

  const fetchAfter = useCallback(async (after: number, replace: boolean, prefix: string) => {
    const mine = ++generation.current;
    try {
      const page = await operations.activity(
        { after, limit: PAGE, ...(prefix ? { action: prefix } : {}) }
      );
      if (generation.current !== mine) return;
      setError(null);
      setMore(page.more);
      setCursor(page.nextCursor);
      setEvents((current) => {
        if (replace) return page.events;
        const seen = new Set(current.map((event) => event.id));
        return [...current, ...page.events.filter((event) => !seen.has(event.id))];
      });
    } catch (cause) {
      if (generation.current !== mine) return;
      setError(cause instanceof ApiError ? cause : new ApiError(String(cause), { code: "UNEXPECTED" }));
    } finally {
      if (generation.current === mine) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchAfter(0, true, applied);
  }, [applied, fetchAfter]);

  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => fetchAfter(cursor, false, applied), POLL_MS);
    return () => clearInterval(timer);
  }, [polling, cursor, applied, fetchAfter]);

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 font-serif text-2xl font-bold tracking-tight text-foreground md:text-[28px]">
            <ShipWheelIcon className="h-6 w-6 text-primary" />
            Activity
          </h1>
          <p className="text-[13px] text-muted-foreground">
            {plural(events.length, "event")} loaded, newest last. Cursor at{" "}
            <span className="font-mono text-[12px] text-foreground">{cursor}</span>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={action}
            onChange={(event) => setAction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setApplied(action.trim());
            }}
            placeholder="action prefix, e.g. run."
            className="h-8 w-44 bg-surface/50 border-border text-foreground text-[12.5px]"
          />
          <Button variant="secondary" size="sm" onClick={() => setApplied(action.trim())}>
            Filter
          </Button>
          <Button
            variant={polling ? "default" : "outline"}
            size="sm"
            onClick={() => setPolling((value) => !value)}
          >
            {polling ? "Polling on" : "Polling paused"}
          </Button>
        </div>
      </header>

      {error && (
        <ReadError error={error} label="Event feed unavailable" onRetry={() => fetchAfter(cursor, false, applied)} />
      )}

      <Monitoring />

      <Card className="border-border bg-card shadow-subtle">
      <CardContent className="space-y-1 pt-5">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-9 rounded-md" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            icon={ShipWheelIcon}
            title="No events"
            description={
              applied
                ? `No activity rows begin with "${applied}" in this workspace yet.`
                : "Nothing has been recorded in this workspace's event log."
            }
          />
        ) : (
          events.map((event) => (
            <div
              key={event.id}
              className="flex flex-wrap items-baseline gap-2 border-b border-border/30 px-1 py-1.5 text-[12.5px] last:border-b-0"
            >
              <span className="font-mono text-[11px] text-muted-foreground">#{event.id}</span>
              <Badge variant="outline" className="font-mono text-[10.5px]">
                {event.action}
              </Badge>
              <span className="min-w-0 flex-1 text-muted-foreground">{event.message}</span>
              {event.run_id && (
                <span className="font-mono text-[10.5px] text-muted-foreground">
                  run {event.run_id.slice(0, 8)}
                </span>
              )}
              <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/80">{event.created_at}</span>
            </div>
          ))
        )}

        {more && (
          <p className="pt-2 text-[11.5px] text-muted-foreground">
            Newer events exist beyond this cursor; the poll will bring them in while it is running.
          </p>
        )}
      </CardContent>
    </Card>
    </div>
  );
}

/** The queue's own figures, from the same call the dashboard header uses. */
function Monitoring() {
  const [summary, setSummary] = useState<MonitoringResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    operations
      .monitoring()
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause : new ApiError(String(cause)));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ReadError error={error} label="Queue figures unavailable" />;
  if (!summary) return <Skeleton className="h-20 w-full rounded-xl" />;

  return (
    <Card className="border-border bg-card shadow-subtle">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 font-serif text-lg font-bold tracking-tight">
          <NauticalInstrumentIcon className="h-4 w-4 text-tan" />
          Queue and worker
        </CardTitle>
        <CardDescription className="text-[12px]">{summary.queue.scope}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Metric label="Pending jobs" value={summary.queue.pending} />
        <Metric label="Running jobs" value={summary.queue.running} />
        <Metric label="Active runs" value={summary.runs.active} />
        <Metric label="Exports queued" value={summary.exports.QUEUED ?? 0} />
        <Badge variant={summary.worker.running ? "success" : "danger"}>
          worker {summary.worker.running ? "running" : "stopped"}
        </Badge>
        <Badge variant={summary.worker.enabled ? "info" : "warning"}>
          execution {summary.worker.enabled ? "enabled" : "disabled"}
        </Badge>
        <span className="text-[11.5px] text-muted-foreground">
          {formatNumber(summary.worker.inFlight)} in flight · {formatNumber(summary.worker.freeSlots)} free
          slots · lease {summary.worker.leaseSeconds}s
        </span>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-serif text-[19px] font-bold leading-none text-foreground">
        {formatNumber(value)}
      </span>
      <span className="text-[11.5px] font-medium text-muted-foreground">{label}</span>
    </div>
  );
}
