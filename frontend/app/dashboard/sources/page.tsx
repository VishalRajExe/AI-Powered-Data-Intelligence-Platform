"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { LighthouseIcon } from "@/components/icons";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ReadError } from "@/components/common/read-error";
import { SourcesPanel } from "@/components/dataset/sources-panel";
import { datasets } from "@/lib/api/endpoints";
import { useLive } from "@/hooks/use-live";
import { formatNumber, formatRelativeTime } from "@/lib/utils";

/**
 * Which sources backed the data.
 *
 * There is deliberately no global source list: sources belong to a dataset, and
 * `/api/v1/datasets/{id}/sources` is the endpoint that knows how each one was obtained. The previous
 * build faked a cross-dataset view by fetching every dataset in the browser; this one asks which
 * dataset you mean instead.
 */
export default function SourcesPage() {
  const [chosen, setChosen] = useState<string | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) => datasets.list({ limit: 50 }, signal),
    []
  );
  const { data, error, loading, settled, reload } = useLive(load);

  const list = data?.datasets ?? [];
  const active = chosen ?? list[0]?.id ?? null;

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 font-serif text-2xl font-bold tracking-tight text-foreground md:text-[28px]">
          <LighthouseIcon className="h-6 w-6 text-primary" />
          Sources
        </h1>
        <p className="text-[13px] text-muted-foreground">
          Pick a dataset to see the pages behind its rows, and whether a tool actually fetched each one.
        </p>
      </header>

      {error && <ReadError error={error} label="Dataset list unavailable" onRetry={reload} />}

      {loading && !settled ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : list.length === 0 ? (
        <Card className="border-border bg-card shadow-subtle">
          <CardContent className="pt-5 text-[13px] text-muted-foreground">
            No datasets exist in this workspace yet, so there are no sources to list.{" "}
            <Link href="/dashboard/research/new" className="font-medium text-foreground hover:underline">
              Start a research request
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {list.map((dataset) => (
              <button
                key={dataset.id}
                type="button"
                onClick={() => setChosen(dataset.id)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  dataset.id === active
                    ? "border-tan bg-surface text-foreground"
                    : "border-border/70 bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                <p className="max-w-[240px] truncate text-[12.5px] font-semibold">
                  {dataset.entityType || dataset.objective || dataset.id}
                </p>
                <p className="mt-0.5 text-[11px]">
                  {formatNumber(dataset.sourceCount)} sources · {formatNumber(dataset.rowCount)} rows ·{" "}
                  {formatRelativeTime(dataset.updatedAt ?? dataset.createdAt)}
                </p>
              </button>
            ))}
          </div>

          {active && <SourcesPanel datasetId={active} />}
        </>
      )}
    </div>
  );
}
