import Link from "next/link";
import { ShipLogIcon, TreasureChestIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ReadError } from "@/components/common/read-error";
import { Pagination } from "@/components/common/pagination";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime, plural } from "@/lib/utils";
import type { ApiError } from "@/lib/api/client";
import type { DatasetSummary } from "@/lib/api/types";

/** The datasets list, in the same card the dashboard reuses for its four newest. */
export function DatasetList({
  datasets,
  total,
  page,
  pageSize,
  loading,
  error,
  onPageChange,
}: {
  datasets: DatasetSummary[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: ApiError | null;
  onPageChange: (page: number) => void;
}) {
  return (
    <Card className="border-border bg-card shadow-subtle">
      <CardHeader className="pb-3">
        <CardTitle className="font-serif text-lg font-bold tracking-tight">
          {loading && !datasets.length ? "Datasets" : plural(total, "dataset")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0.5">
        {error && <ReadError error={error} label="Datasets unavailable" />}
        {loading ? (
          <div className="space-y-2 py-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 rounded-md" />
            ))}
          </div>
        ) : datasets.length === 0 ? (
          <EmptyState
            icon={ShipLogIcon}
            title="No datasets yet"
            description="A dataset appears when a run's save step writes one. Nothing is listed before that happens."
          />
        ) : (
          datasets.map((dataset) => (
            <Link
              key={dataset.id}
              href={`/dashboard/datasets/${dataset.id}`}
              className="flex items-center justify-between gap-3 rounded-md border-b border-border/30 px-3 py-2.5 transition-colors hover:bg-surface last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-semibold text-foreground">
                  {dataset.entityType || dataset.objective || dataset.id}
                </p>
                <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {dataset.objective && dataset.entityType ? `${dataset.objective} · ` : ""}
                  {plural(dataset.rowCount, "row")} · {plural(dataset.validRowCount ?? 0, "valid row")} ·{" "}
                  {plural(dataset.sourceCount, "source")} ·{" "}
                  {formatRelativeTime(dataset.updatedAt ?? dataset.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {typeof dataset.qualityScore === "number" && (
                  <Badge variant={dataset.qualityScore >= 0.8 ? "success" : "warning"}>
                    quality {Math.round(dataset.qualityScore * 100)}%
                  </Badge>
                )}
                <Badge
                  variant={
                    dataset.status === "COMPLETED"
                      ? "success"
                      : dataset.status === "FAILED"
                        ? "danger"
                        : dataset.status === "PARTIAL"
                          ? "warning"
                          : "default"
                  }
                >
                  {dataset.status}
                </Badge>
                <TreasureChestIcon className="h-4 w-4 text-muted-foreground" />
              </div>
            </Link>
          ))
        )}

        <Pagination
          currentPage={page + 1}
          totalPages={Math.max(Math.ceil(total / pageSize), 1)}
          totalItems={total}
          pageSize={pageSize}
          itemLabel="datasets"
          onPageChange={onPageChange}
        />
      </CardContent>
    </Card>
  );
}
