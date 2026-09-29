"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { LighthouseIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { fetchBackendStatus, type BackendStatusReport } from "@/lib/api/health";
import type { ComponentStatus, ReadinessComponent, ReadinessComponents } from "@/lib/api/types";

/** Component keys the Phase 1 readiness envelope is specified to contain. */
const EXPECTED_COMPONENTS: { key: keyof ReadinessComponents; label: string }[] = [
  { key: "mysql", label: "MySQL" },
  { key: "aiService", label: "AI service (via backend)" },
  { key: "credentials", label: "Credentials" },
];

type Phase = "loading" | "loaded";

function StatusPill({ status }: { status: ComponentStatus | "UNREPORTED" }) {
  const map = {
    UP: { variant: "success" as const, label: "UP" },
    DOWN: { variant: "danger" as const, label: "DOWN" },
    UNREPORTED: { variant: "default" as const, label: "NOT REPORTED" },
  };
  const c = map[status];
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

function DetailList({ details }: { details?: Record<string, string | number | boolean | null> }) {
  if (!details || Object.keys(details).length === 0) {
    return <p className="text-[12px] italic text-muted-foreground">No details reported.</p>;
  }
  return (
    <dl className="mt-2 space-y-1">
      {Object.entries(details).map(([key, value]) => (
        <div key={key} className="flex gap-2 text-[12px]">
          <dt className="shrink-0 font-medium text-muted-foreground">{key}</dt>
          <dd className="min-w-0 break-all font-mono text-foreground">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-[13px]", value ? "text-foreground" : "text-muted-foreground/70 italic")}>
        {value ?? "unavailable"}
      </span>
    </div>
  );
}

export default function StatusPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [report, setReport] = useState<BackendStatusReport | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setRefreshing(true);
    const next = await fetchBackendStatus({ signal });
    if (signal?.aborted) return;
    setReport(next);
    setPhase("loaded");
    setRefreshing(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const unreachable = phase === "loaded" && report !== null && !report.backendReached;
  const readinessData = report?.readiness.data ?? null;
  const healthData = report?.health.data ?? null;

  const allUp =
    healthData?.status === "UP" &&
    readinessData?.status === "UP" &&
    (readinessData.components ? Object.values(readinessData.components).every((c) => c?.status === "UP") : false);

  const banner = unreachable
    ? { variant: "danger" as const, title: "Backend unreachable", detail: "No HTTP response was received from /api/v1/health or /api/v1/ready." }
    : !report || (report.health.error && report.readiness.error)
      ? { variant: "warning" as const, title: "Status incomplete", detail: "Neither endpoint returned usable data." }
      : report.health.error || report.readiness.error
        ? { variant: "warning" as const, title: "Partially reported", detail: "One endpoint answered; the other did not." }
        : allUp
          ? { variant: "success" as const, title: "Backend healthy", detail: "Both endpoints reported UP." }
          : { variant: "danger" as const, title: "Backend reporting DOWN", detail: "At least one endpoint reported a non-UP status." };

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 font-serif text-2xl font-bold tracking-tight text-foreground md:text-[28px]">
            <LighthouseIcon className="h-6 w-6 text-primary" />
            Backend Status
          </h1>
          <p className="text-[13px] text-muted-foreground">
            Live result of <span className="font-mono">GET /api/v1/health</span> and{" "}
            <span className="font-mono">GET /api/v1/ready</span>, proxied by Next.js to the backend origin.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => load()} disabled={refreshing}>
          {refreshing ? "Checking…" : "Retry"}
        </Button>
      </header>

      <Card>
        <CardContent className="pt-5">
          {phase === "loading" ? (
            <Skeleton className="h-6 w-56" />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={banner.variant}>{banner.title}</Badge>
              <span className="text-[13px] text-muted-foreground">{banner.detail}</span>
              {report && (
                <span className="ml-auto font-mono text-[11px] text-muted-foreground/80">
                  probe started {report.checkedAt}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {phase === "loading" && (
        <div className="grid gap-5 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Card key={i}>
              <CardHeader className="space-y-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {phase === "loaded" && report && (
        <div className="grid gap-5 md:grid-cols-2">
          {/* Liveness */}
          <Card>
            <CardHeader>
              <CardTitle>Liveness</CardTitle>
              <CardDescription>
                <span className="font-mono text-[12px]">GET /api/v1/health</span>
                {report.health.httpStatus !== null ? ` · HTTP ${report.health.httpStatus}` : " · no response"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {healthData === null ? (
                <p className="text-[13px] text-danger">
                  {report.health.error?.message ??
                    "The endpoint answered but returned no parsable JSON body."}
                </p>
              ) : (
                <div className="space-y-3">
                  <Field label="Status" value={healthData?.status} />
                  <Separator />
                  <Field label="Application" value={healthData?.application} />
                  <Separator />
                  <Field label="Profile" value={healthData?.profile} />
                  <Separator />
                  <Field label="Version" value={healthData?.version} />
                  <Separator />
                  <Field label="Timestamp" value={healthData?.timestamp} />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Readiness */}
          <Card>
            <CardHeader>
              <CardTitle>Readiness</CardTitle>
              <CardDescription>
                <span className="font-mono text-[12px]">GET /api/v1/ready</span>
                {report.readiness.httpStatus !== null
                  ? ` · HTTP ${report.readiness.httpStatus} (503 means not ready)`
                  : " · no response"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {readinessData === null ? (
                <p className="text-[13px] text-danger">
                  {report.readiness.error?.message ??
                    "The endpoint answered but returned no parsable JSON body."}
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</span>
                    <StatusPill status={readinessData?.status ?? "UNREPORTED"} />
                  </div>
                  <Field label="Timestamp" value={readinessData?.timestamp} />

                  <Separator />

                  <div className="space-y-3">
                    {EXPECTED_COMPONENTS.map(({ key, label }) => {
                      const component: ReadinessComponent | undefined = readinessData?.components?.[key];
                      return (
                        <div key={key} className="rounded-md border border-border/70 bg-surface/50 px-3 py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[13px] font-medium text-foreground">{label}</span>
                            <StatusPill status={component?.status ?? "UNREPORTED"} />
                          </div>
                          <DetailList details={component?.details} />
                        </div>
                      );
                    })}
                    {readinessData?.components === undefined && (
                      <p className="text-[12px] italic text-muted-foreground">
                        The backend did not include a components object in this response.
                      </p>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {unreachable && (
        <Card className="border-danger/40">
          <CardContent className="pt-5">
            <p className="text-[13px] leading-relaxed text-foreground">
              No readable JSON came back from the backend. Observed:{" "}
              <span className="font-mono text-[12px]">
                /health → {report.health.httpStatus ?? "no response"}
              </span>
              ,{" "}
              <span className="font-mono text-[12px]">
                /ready → {report.readiness.httpStatus ?? "no response"}
              </span>
              . A 500 here is the Next.js proxy reporting that nothing is listening on the
              configured <span className="font-mono text-[12px]">BACKEND_ORIGIN</span>. Nothing on this page
              is filled in with assumed values.
            </p>
            <div className="mt-3">
              <Button size="sm" onClick={() => load()} disabled={refreshing}>
                {refreshing ? "Checking…" : "Retry"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
