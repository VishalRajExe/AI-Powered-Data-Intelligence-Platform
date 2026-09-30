"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { TreasureMapIcon } from "@/components/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { ReadError } from "@/components/common/read-error";
import { Pagination } from "@/components/common/pagination";
import { workflows as workflowApi } from "@/lib/api/endpoints";
import { useLive } from "@/hooks/use-live";
import { formatNumber, formatRelativeTime, plural } from "@/lib/utils";

const PAGE_SIZE = 20;

/**
 * Every workflow this workspace created, newest first.
 *
 * The listing is the operations read model's own page: `runCount` and `latestPlanVersion` are
 * counted by MySQL against the rows that exist, not accumulated here.
 */
export default function WorkflowsPage() {
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<string>("");

  const load = useCallback(
    (signal?: AbortSignal) =>
      workflowApi.list(
        { limit: PAGE_SIZE, page, ...(status ? { status } : {}) },
        signal
      ),
    [page, status]
  );
  const { data, error, loading, settled, reload } = useLive(load);

  const rows = data?.workflows ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 font-serif text-2xl font-bold tracking-tight text-foreground md:text-[28px]">
            <TreasureMapIcon className="h-6 w-6 text-primary" />
            Workflows
          </h1>
          <p className="text-[13px] text-muted-foreground">
            Each row is one stored prompt. Planning and collection happen on the workflow&apos;s own
            page, and nothing here is a run status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(0);
            }}
            className="h-8 rounded-md border border-border bg-surface px-2 text-[12.5px] text-foreground"
            aria-label="Filter by workflow status"
          >
            <option value="">Any status</option>
            {["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <Button variant="secondary" size="sm" onClick={reload} disabled={loading}>
            {settled && !loading ? "Refresh" : "Loading…"}
          </Button>
          <Link href="/dashboard/research/new">
            <Button size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> New research
            </Button>
          </Link>
        </div>
      </header>

      {error && <ReadError error={error} label="Workflows unavailable" onRetry={reload} />}

      <Card className="border-border bg-card shadow-subtle">
        <CardHeader className="pb-3">
          <CardTitle className="font-serif text-lg font-bold tracking-tight">
            {settled && !error ? plural(total, "workflow") : "Workflows"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-0.5">
          {loading && !settled ? (
            <div className="space-y-2 py-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-14 rounded-md" />
              ))}
            </div>
          ) : rows.length === 0 && !error ? (
            <EmptyState
              icon={TreasureMapIcon}
              title="No workflows yet"
              description="Describe the data you need and the system will plan the collection around it. Use New research above."
            />
          ) : (
            rows.map((workflow) => (
              <Link
                key={workflow.id}
                href={`/dashboard/workflows/${workflow.id}`}
                className="flex items-center justify-between gap-3 rounded-md border-b border-border/30 px-3 py-2.5 transition-colors hover:bg-surface last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold text-foreground">{workflow.name}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {formatNumber(workflow.runCount ?? 0)} runs ·{" "}
                    {workflow.latestPlanVersion
                      ? `plan v${workflow.latestPlanVersion}`
                      : "no plan stored"}{" "}
                    · {formatRelativeTime(workflow.updatedAt ?? workflow.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge
                    variant={
                      workflow.planningStatus === "PLANNED"
                        ? "success"
                        : workflow.planningStatus === "FAILED"
                          ? "danger"
                          : workflow.planningStatus === "PLANNING"
                            ? "info"
                            : "default"
                    }
                  >
                    {workflow.planningStatus}
                  </Badge>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </Link>
            ))
          )}

          <Pagination
            currentPage={page + 1}
            totalPages={Math.max(Math.ceil(total / PAGE_SIZE), 1)}
            totalItems={total}
            pageSize={PAGE_SIZE}
            itemLabel="workflows"
            onPageChange={(next) => setPage(next - 1)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
