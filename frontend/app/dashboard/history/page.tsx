"use client";

import { useCallback } from "react";
import Link from "next/link";
import { HistoryScrollIcon, CargoIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { ReadError } from "@/components/common/read-error";
import { RunStatusBadge } from "@/components/workflow/run-status";
import { exportsApi, workflows } from "@/lib/api/endpoints";
import { useLive } from "@/hooks/use-live";
import { formatNumber, formatRelativeTime } from "@/lib/utils";

/**
 * What has run here before, and what has been written out.
 *
 * Every attempt is kept, including the ones that failed, because the rows are the history rather
 * than a summary someone reconstructed from process memory — which is what made the previous
 * build's history disappear on a restart.
 */
export default function HistoryPage() {
  const loadRuns = useCallback(
    (signal?: AbortSignal) => workflows.recentRuns(50, signal),
    []
  );
  const loadExports = useCallback(
    (signal?: AbortSignal) => exportsApi.list({ limit: 25 }, signal),
    []
  );

  const runs = useLive(loadRuns);
  const exports = useLive(loadExports);

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 font-serif text-2xl font-bold tracking-tight text-foreground md:text-[28px]">
            <HistoryScrollIcon className="h-6 w-6 text-primary" />
            History
          </h1>
          <p className="text-[13px] text-muted-foreground">
            The 50 most recent runs and the 25 most recent exports across this workspace.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={runs.reload} disabled={runs.loading}>
            Refresh
          </Button>
        </div>
      </header>

      {runs.data && (
        <Card className="border-border bg-card shadow-subtle">
          <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-2 py-4 text-[12px] text-muted-foreground">
            <span>
              worker <span className="font-mono text-[11.5px] text-foreground">{runs.data.worker.id}</span>
            </span>
            <Badge variant={runs.data.worker.running ? "success" : "danger"}>
              {runs.data.worker.running ? "polling" : "stopped"}
            </Badge>
            <span>{formatNumber(runs.data.worker.inFlight)} in flight</span>
            <span>{formatNumber(runs.data.worker.freeSlots)} free slots</span>
          </CardContent>
        </Card>
      )}

      {runs.error && <ReadError error={runs.error} label="Run history unavailable" onRetry={runs.reload} />}

      <Card className="border-border bg-card shadow-subtle">
        <CardHeader className="pb-3">
          <CardTitle className="font-serif text-lg font-bold tracking-tight">Runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0.5">
          {runs.loading && !runs.settled ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 rounded-md" />
              ))}
            </div>
          ) : (runs.data?.runs ?? []).length === 0 && !runs.error ? (
            <EmptyState
              icon={HistoryScrollIcon}
              title="No runs yet"
              description="A run appears when a planned workflow is started. Nothing is listed before then."
            />
          ) : (
            (runs.data?.runs ?? []).map((run) => (
              <Link
                key={run.id}
                href={`/dashboard/workflows/${run.workflowId}?run=${run.id}`}
                className="flex items-center justify-between gap-3 rounded-md border-b border-border/30 px-3 py-2.5 transition-colors hover:bg-surface last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="font-mono text-[11.5px] text-foreground">{run.id}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    attempt {run.attempt} · {run.progress}% ·{" "}
                    {formatNumber(run.recordsValid ?? 0)} valid of {formatNumber(run.recordsFound ?? 0)} found ·{" "}
                    {formatNumber(run.sourcesProcessed ?? 0)} sources
                    {run.sourcesFailed ? ` (${run.sourcesFailed} failed)` : ""} ·{" "}
                    {run.createdAt ? formatRelativeTime(run.createdAt) : ""}
                  </p>
                </div>
                <RunStatusBadge status={run.status} />
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      {exports.error && (
        <ReadError error={exports.error} label="Export history unavailable" onRetry={exports.reload} />
      )}

      <Card className="border-border bg-card shadow-subtle">
        <CardHeader className="pb-3">
          <CardTitle className="font-serif text-lg font-bold tracking-tight">Exports</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0.5">
          {exports.loading && !exports.settled ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-12 rounded-md" />
              ))}
            </div>
          ) : (exports.data?.exports ?? []).length === 0 && !exports.error ? (
            <EmptyState
              icon={CargoIcon}
              title="No exports yet"
              description="Files are written by the worker when a dataset's export is requested."
            />
          ) : (
            (exports.data?.exports ?? []).map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between gap-3 rounded-md border-b border-border/30 px-3 py-2.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-foreground">
                    {job.fileName || job.format?.toUpperCase() || "export"}
                  </p>
                  <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                    dataset <span className="font-mono text-[11px]">{job.datasetId}</span> ·{" "}
                    {formatNumber(job.writtenRows ?? 0)} of {formatNumber(job.totalRows ?? 0)} rows
                    {typeof job.fileSizeBytes === "number" ? ` · ${formatNumber(job.fileSizeBytes)} bytes` : ""}
                  </p>
                  <div className="mt-1.5 max-w-sm">
                    <Progress value={job.progressPercent ?? 0} />
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <Badge
                    variant={
                      job.status === "COMPLETED"
                        ? "success"
                        : job.status === "FAILED"
                          ? "danger"
                          : job.status === "CANCELLED"
                            ? "default"
                            : "info"
                    }
                  >
                    {job.status}
                  </Badge>
                  {job.status === "COMPLETED" && (
                    <a
                      href={exportsApi.downloadHref(job.id)}
                      className="text-[11.5px] font-semibold text-primary underline underline-offset-2 hover:text-foreground"
                    >
                      Download
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
