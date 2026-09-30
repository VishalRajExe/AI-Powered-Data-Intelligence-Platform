"use client";

import { useCallback } from "react";
import Link from "next/link";
import {
  CompassIcon,
  ShipWheelIcon,
  CargoIcon,
  LighthouseIcon,
} from "@/components/icons";
import { PromptBox } from "@/components/dashboard/prompt-box";
import { StatCard } from "@/components/dashboard/stat-card";
import { RecentWorkflows } from "@/components/dashboard/recent-workflows";
import { RecentDatasets } from "@/components/dashboard/recent-datasets";
import { ReadError } from "@/components/common/read-error";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/utils";
import { useLive } from "@/hooks/use-live";
import { datasets as datasetApi, operations, workflows as workflowApi } from "@/lib/api/endpoints";

/**
 * The overview. Every figure below is a count the backend measured: `GET /api/v1/monitoring`
 * aggregates with `COUNT(*)` against MySQL, and the two lists are the same paginated endpoints the
 * dedicated screens use, asked for their first four rows.
 */
export default function DashboardPage() {
  const loadMonitoring = useCallback(
    (signal?: AbortSignal) => operations.monitoring(signal),
    []
  );
  const loadWorkflows = useCallback(
    (signal?: AbortSignal) => workflowApi.list({ limit: 4 }, signal),
    []
  );
  const loadDatasets = useCallback(
    (signal?: AbortSignal) => datasetApi.list({ limit: 4 }, signal),
    []
  );

  const summary = useLive(loadMonitoring);
  const workflowList = useLive(loadWorkflows);
  const datasetList = useLive(loadDatasets);

  const monitor = summary.data;
  const loading = summary.loading && !summary.settled;

  return (
    <div className="space-y-6 animate-fade-in">
      <PromptBox />

      {summary.error && (
        <ReadError
          error={summary.error}
          label="Overview figures unavailable"
          onRetry={summary.reload}
        />
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {loading ? (
          [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[88px] rounded-xl" />)
        ) : monitor ? (
          <>
            <StatCard
              icon={CompassIcon}
              label="Workflows"
              value={formatNumber(monitor.workflows.total)}
              tone="primary"
            />
            <StatCard
              icon={ShipWheelIcon}
              label="Active runs"
              value={formatNumber(monitor.runs.active)}
              tone="warning"
            />
            <StatCard
              icon={CargoIcon}
              label="Rows stored"
              value={formatNumber(monitor.datasets.rows.rows)}
              tone="success"
            />
            <StatCard
              icon={LighthouseIcon}
              label="Sources recorded"
              value={formatNumber(monitor.datasets.rows.sources)}
              tone="default"
            />
          </>
        ) : (
          // The read failed rather than returned nothing, so the slots say so instead of showing
          // four zeros that would look like an empty workspace.
          [1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex h-[88px] items-center rounded-lg border border-dashed border-border bg-card/50 px-4 text-[12px] text-muted-foreground"
            >
              not reported
            </div>
          ))
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecentWorkflows
          workflows={workflowList.data?.workflows ?? []}
          loading={workflowList.loading && !workflowList.settled}
        />
        <RecentDatasets
          datasets={datasetList.data?.datasets ?? []}
          loading={datasetList.loading && !datasetList.settled}
        />
      </div>

      {(workflowList.error || datasetList.error) && (
        <ReadError
          error={(workflowList.error ?? datasetList.error)!}
          label={workflowList.error ? "Recent workflows unavailable" : "Recent datasets unavailable"}
          onRetry={workflowList.error ? workflowList.reload : datasetList.reload}
        />
      )}

      <p className="text-[12px] leading-relaxed text-muted-foreground/90">
        <span className="font-mono">Active runs</span> counts rows in PENDING, PLANNING or RUNNING.
        Queue depth and worker slots live on{" "}
        <Link href="/dashboard/activity" className="font-medium text-foreground hover:underline">
          Activity
        </Link>
        .
      </p>
    </div>
  );
}
