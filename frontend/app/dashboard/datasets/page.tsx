"use client";

import { useCallback, useState } from "react";
import { ShipLogIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DatasetList } from "@/components/dataset/dataset-list";
import { datasets } from "@/lib/api/endpoints";
import { useLive } from "@/hooks/use-live";

const PAGE_SIZE = 20;

/** Every dataset this workspace's runs saved, newest first. */
export default function DatasetsPage() {
  const [page, setPage] = useState(0);

  const load = useCallback(
    (signal?: AbortSignal) => datasets.list({ limit: PAGE_SIZE, page }, signal),
    [page]
  );
  const { data, error, loading, settled, reload } = useLive(load);

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 font-serif text-2xl font-bold tracking-tight text-foreground md:text-[28px]">
            <ShipLogIcon className="h-6 w-6 text-primary" />
            Datasets
          </h1>
          <p className="text-[13px] text-muted-foreground">
            Row counts are <span className="font-mono">COUNT(*)</span> of the rows table, and every
            record links back to the run, step and sources that produced it.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={reload} disabled={loading}>
          {settled && !loading ? "Refresh" : "Loading…"}
        </Button>
      </header>

      <DatasetList
        datasets={data?.datasets ?? []}
        total={data?.total ?? 0}
        page={page}
        pageSize={PAGE_SIZE}
        loading={loading && !settled}
        error={error}
        onPageChange={(next) => setPage(next - 1)}
      />
    </div>
  );
}
