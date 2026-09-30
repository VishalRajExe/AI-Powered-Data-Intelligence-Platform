"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { RunStatusBadge } from "@/components/workflow/run-status";
import { formatNumber, formatRelativeTime } from "@/lib/utils";
import type { ActivityEvent, JobView, RunView, StepView } from "@/lib/api/types";

/**
 * One run, drawn from its row.
 *
 * Progress is the number the queue persisted, and the checklist is the step rows that produced it.
 * Nothing here estimates completion from "it is running": a run wedged for twenty minutes shows the
 * same figure its row shows, which is the only honest answer available.
 */
export function RunPanel({
  run,
  steps,
  jobs,
  events,
  canWrite,
  onCancel,
  cancelling,
}: {
  run: RunView;
  steps: StepView[];
  jobs: JobView[];
  events: ActivityEvent[];
  canWrite: boolean;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const jobFor = (step: StepView) => jobs.find((job) => job.stepId === step.id);
  const terminal = ["COMPLETED", "FAILED", "CANCELLED", "PARTIAL"].includes(run.status);

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card shadow-subtle">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="font-serif text-lg font-bold tracking-tight">
              Run <span className="font-mono text-[13px] font-normal text-muted-foreground">{run.id}</span>
            </CardTitle>
            <RunStatusBadge status={run.status} />
          </div>
          <CardDescription className="font-mono text-[11.5px]">
            attempt {run.attempt} · plan {run.planId ?? "not attached"} · started{" "}
            {run.startedAt ? formatRelativeTime(run.startedAt) : "not yet"}
            {run.finishedAt ? ` · finished ${formatRelativeTime(run.finishedAt)}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[12px] text-muted-foreground">
              <span>Progress recorded by the queue</span>
              <span className="font-mono text-foreground">{run.progress}%</span>
            </div>
            <Progress value={run.progress} />
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Counter label="Records found" value={run.recordsFound} />
            <Counter label="Records valid" value={run.recordsValid} />
            <Counter label="Duplicates" value={run.duplicateCount} />
            <Counter label="Sources ok / failed" value={run.sourcesProcessed} suffix={`/ ${run.sourcesFailed ?? 0}`} />
          </div>

          {(run.errorCode || run.errorMessage) && (
            <div className="rounded-lg bg-danger-soft border border-danger/20 p-3 text-[12.5px] text-danger font-medium">
              {run.errorCode && <span className="font-mono">{run.errorCode}</span>}
              {run.errorCode && run.errorMessage ? " — " : ""}
              {run.errorMessage}
            </div>
          )}

          {!terminal && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <p className="text-[12px] text-muted-foreground">
                {run.cancelRequested
                  ? "Cancellation requested — the worker stops at its next checkpoint."
                  : "This run has not reached a terminal state."}
              </p>
              {!run.cancelRequested && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!canWrite}
                  loading={cancelling}
                  onClick={onCancel}
                >
                  Cancel run
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-subtle">
        <CardHeader className="pb-3">
          <CardTitle className="font-serif text-lg font-bold tracking-tight">Stages</CardTitle>
          <CardDescription className="text-[12px]">
            One row per stored step. A step that failed and retried shows its latest outcome; the job
            beside it carries the attempt count.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {steps.map((step) => {
            const job = jobFor(step);
            return (
              <div
                key={step.id}
                className="rounded-md border border-border/60 bg-surface/40 px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-[11px] font-semibold text-foreground">
                    {step.sequence}
                  </span>
                  <span className="text-[13px] font-semibold text-foreground">{step.stepKey}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{step.type}</span>
                  <Badge
                    variant={
                      step.status === "COMPLETED"
                        ? "success"
                        : step.status === "FAILED"
                          ? "danger"
                          : step.status === "RUNNING"
                            ? "info"
                            : "default"
                    }
                    className="ml-auto"
                  >
                    {step.status}
                  </Badge>
                </div>
                <p className="mt-1 text-[11.5px] text-muted-foreground">
                  {step.dependsOn && step.dependsOn.length > 0 ? `after ${step.dependsOn.join(", ")} · ` : ""}
                  {typeof step.durationMs === "number" ? `${formatNumber(step.durationMs)} ms · ` : ""}
                  attempt {step.attempt}
                  {job ? ` · job ${job.attemptCount}/${job.maxAttempts} ${job.status}` : ""}
                  {job?.leaseExpiresAt ? ` · lease until ${formatRelativeTime(job.leaseExpiresAt)}` : ""}
                </p>
                {(step.errorCode || step.errorMessage) && (
                  <p className="mt-1 text-[11.5px] font-medium text-danger">
                    {step.errorCode && <span className="font-mono">{step.errorCode} </span>}
                    {step.errorMessage}
                  </p>
                )}
              </div>
            );
          })}
          {steps.length === 0 && (
            <p className="text-[13px] text-muted-foreground">
              This run has no step rows yet, so nothing has been planned or claimed.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-subtle">
        <CardHeader className="pb-3">
          <CardTitle className="font-serif text-lg font-bold tracking-tight">Event log</CardTitle>
          <CardDescription className="text-[12px]">
            The {events.length} most recent rows in <span className="font-mono">activity_events</span>{" "}
            for this run, oldest first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No events recorded for this run.</p>
          ) : (
            <ul className="space-y-1.5">
              {events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline gap-2 text-[12.5px]">
                  <span className="font-mono text-[11px] text-muted-foreground">#{event.id}</span>
                  <span className="font-medium text-foreground">{event.action}</span>
                  <span className="text-muted-foreground">{event.message}</span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground/80">
                    {event.created_at}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Counter({ label, value, suffix }: { label: string; value?: number; suffix?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface/50 px-3 py-2.5">
      <p className="font-serif text-[19px] font-bold leading-tight text-foreground">
        {typeof value === "number" ? formatNumber(value) : "unreported"}
        {suffix && typeof value === "number" && (
          <span className="text-[13px] font-medium text-muted-foreground">{suffix}</span>
        )}
      </p>
      <p className="truncate text-[11.5px] font-medium text-muted-foreground">{label}</p>
    </div>
  );
}
