"use client";

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SailingShipIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ReadError } from "@/components/common/read-error";
import { RunPanel } from "@/components/workflow/run-view";
import { RunStatusBadge } from "@/components/workflow/run-status";
import { workflows as workflowApi } from "@/lib/api/endpoints";
import { useAuth } from "@/lib/auth";
import { useLive } from "@/hooks/use-live";
import { formatNumber, formatRelativeTime } from "@/lib/utils";
import type { RunDetailResponse, StepHistoryResponse } from "@/lib/api/types";

const POLL_MS = 5000;
const TERMINAL = ["COMPLETED", "FAILED", "CANCELLED", "PARTIAL"];

/**
 * One workflow: its attempts, and the rows the queue wrote for the selected attempt.
 *
 * There is no `GET /api/v1/workflows/{id}`, so existence is proven by the run-history endpoint,
 * which answers 404 for an id this workspace cannot see. The prompt text comes from the listing
 * endpoint; if this workflow is not in the newest 100 rows, the page says so instead of guessing.
 */
function WorkflowDetail({ workflowId }: { workflowId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canWrite } = useAuth();
  const [cancelling, setCancelling] = useState(false);
  const [starting, setStarting] = useState(false);

  const loadHistory = useCallback(
    (signal?: AbortSignal) => workflowApi.runHistory(workflowId, { limit: 50 }, signal),
    [workflowId]
  );
  const history = useLive(loadHistory);
  const runs = history.data?.runs ?? [];
  const selected = searchParams.get("run") ?? runs[0]?.id ?? null;

  const loadDetail = useCallback(
    async (signal?: AbortSignal): Promise<{ run: RunDetailResponse; steps: StepHistoryResponse } | null> => {
      if (!selected) return null;
      const [run, steps] = await Promise.all([
        workflowApi.run(selected, signal),
        workflowApi.stepHistory(selected, signal),
      ]);
      return { run, steps };
    },
    [selected]
  );
  const detail = useLive(loadDetail);

  const loadListing = useCallback(
    (signal?: AbortSignal) => workflowApi.list({ limit: 100 }, signal),
    []
  );
  const listing = useLive(loadListing);
  const workflow = useMemo(
    () => listing.data?.workflows.find((found) => found.id === workflowId) ?? null,
    [listing.data, workflowId]
  );

  const runStatus = detail.data?.run.run.status ?? null;
  const reloadDetail = detail.reload;
  useEffect(() => {
    if (!selected || !runStatus || TERMINAL.includes(runStatus)) return;
    const timer = setInterval(reloadDetail, POLL_MS);
    return () => clearInterval(timer);
  }, [selected, runStatus, reloadDetail]);

  async function cancelRun() {
    if (!selected) return;
    setCancelling(true);
    try {
      await workflowApi.cancelRun(selected);
    } finally {
      setCancelling(false);
    }
    reloadDetail();
  }

  async function startRun() {
    setStarting(true);
    try {
      const started = await workflowApi.startRun(workflowId);
      router.push(`/dashboard/workflows/${workflowId}?run=${started.run.id}`);
    } finally {
      setStarting(false);
    }
    history.reload();
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <button
        onClick={() => router.push("/dashboard/workflows")}
        className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to workflows
      </button>

      <header className="space-y-1">
        <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground md:text-[28px]">
          {workflow?.name ?? "Workflow"}
        </h1>
        <p className="font-mono text-[11.5px] text-muted-foreground">{workflowId}</p>
        {workflow ? (
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Stored prompt:</span>{" "}
            {workflow.requirementText}
          </p>
        ) : history.data ? (
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
            This workflow exists — its runs are below — but it is not among the newest 100 rows the
            listing endpoint returned, so its prompt text is not shown.
          </p>
        ) : null}
      </header>

      {history.error && <ReadError error={history.error} label="Workflow unavailable" onRetry={history.reload} />}

      {history.loading && !history.settled && <Skeleton className="h-24 w-full rounded-xl" />}

      {runs.length > 0 && (
        <Card className="border-border bg-card shadow-subtle">
          <CardHeader className="pb-3">
            <CardTitle className="font-serif text-lg font-bold tracking-tight">
              Attempts ({formatNumber(history.data?.total ?? runs.length)})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-0.5">
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => router.push(`/dashboard/workflows/${workflowId}?run=${run.id}`)}
                className={`flex w-full items-center justify-between gap-3 rounded-md border-b border-border/30 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-surface ${
                  run.id === selected ? "bg-surface" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="font-mono text-[12px] text-foreground">{run.id}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    attempt {run.attempt} · {run.progress}% ·{" "}
                    {formatNumber(run.recordsValid ?? 0)} valid of {formatNumber(run.recordsFound ?? 0)}{" "}
                    found · {run.createdAt ? formatRelativeTime(run.createdAt) : ""}
                  </p>
                </div>
                <RunStatusBadge status={run.status} />
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {runs.length === 0 && history.settled && !history.error && (
        <Card className="border-border bg-card shadow-subtle">
          <CardContent className="flex flex-wrap items-center gap-3 pt-5">
            <SailingShipIcon className="h-5 w-5 text-tan" />
            <p className="text-[13px] text-muted-foreground">
              {workflow?.planningStatus === "PLANNED"
                ? "A plan is stored but no run has started from it yet."
                : "This workflow has no plan stored, so there is nothing to run. A plan comes from the New research screen."}
            </p>
            {workflow?.planningStatus === "PLANNED" && (
              <Button
                size="sm"
                disabled={!canWrite}
                loading={starting}
                onClick={startRun}
                className="bg-primary text-primary-foreground hover:bg-primary-hover font-semibold"
              >
                Start a run
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {selected && detail.error && (
        <ReadError error={detail.error} label="Run detail unavailable" onRetry={reloadDetail} />
      )}

      {selected && detail.loading && !detail.settled && <Skeleton className="h-64 w-full rounded-xl" />}

      {selected && detail.data && (
        <RunPanel
          run={detail.data.run.run}
          steps={detail.data.steps.steps}
          jobs={detail.data.run.jobs}
          events={detail.data.steps.events}
          canWrite={canWrite}
          onCancel={cancelRun}
          cancelling={cancelling}
        />
      )}

      {selected && detail.data && !TERMINAL.includes(runStatus ?? "") && (
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          Re-read every {POLL_MS / 1000}s while the run is not terminal.{" "}
          <Badge variant="outline" className="mx-1 align-middle">
            polled
          </Badge>{" "}
          — the event stream itself is still open work (P63), so this polls the same durable rows
          rather than pretending to be pushed.
        </p>
      )}
    </div>
  );
}

export default function WorkflowDetailPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
      <WorkflowDetail workflowId={params.id} />
    </Suspense>
  );
}
