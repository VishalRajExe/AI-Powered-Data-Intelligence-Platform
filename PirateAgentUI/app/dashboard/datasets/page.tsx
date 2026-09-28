"use client";
import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { ShipLogIcon, SpyglassIcon } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/common/pagination";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { formatNumber, formatDate } from "@/lib/utils";

interface DatasetItem {
  id: string;
  name: string;
  description: string;
  recordCount: number;
  sourceCount: number;
  status: string;
  updatedAt: string;
}

interface DatasetListResponse {
  data: DatasetItem[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

export default function DatasetsPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data, loading } = useApi<DatasetListResponse>(
    user ? "/datasets" : null,
    { workspaceId: user?.workspaceId ?? "", userId: user?.id ?? "", limit: 100, search: query || undefined },
    { skip: !user },
  );

  const rawDatasets: DatasetItem[] = data?.data ?? (data as any)?.items ?? [];
  const activeDatasets = rawDatasets.filter((d) => !deletedIds.includes(d.id));

  const pageSize = 6;
  const totalPages = Math.max(1, Math.ceil(activeDatasets.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedDatasets = activeDatasets.slice((safePage - 1) * pageSize, safePage * pageSize);

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this dataset? This will remove all associated records and quality reports.")) {
      return;
    }

    setDeletingId(id);
    try {
      await api.delete(`/datasets/${id}`, {
        workspaceId: user?.workspaceId ?? "",
        userId: user?.id ?? "",
      });
      setDeletedIds((prev) => [...prev, id]);
    } catch (err: any) {
      alert(err?.message || "Failed to delete dataset");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-tan mb-1">
            <ShipLogIcon className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              CARGO MANIFESTS
            </span>
          </div>
          <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            Datasets
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Clean, source-backed intelligence structured from your research missions.
          </p>
        </div>
        <div className="relative w-full max-w-[240px]">
          <SpyglassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search datasets…"
            className="h-8 pl-8 text-[13px] bg-card border-border/80"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[140px] rounded-xl" />
          ))}
        </div>
      ) : activeDatasets.length === 0 ? (
        <EmptyState
          icon={ShipLogIcon}
          title="No datasets yet"
          description="Completed research missions will store verified records here."
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
            {paginatedDatasets.map((d, i) => (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <Link href={`/dashboard/datasets/${d.id}`} className="group block h-full">
                  <Card className="h-full border-border bg-card transition-all hover:border-tan/60 hover:shadow-card relative overflow-hidden">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[14px] font-semibold leading-snug text-foreground group-hover:text-tan transition-colors">
                          {d.name}
                        </p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant={d.status === "ready" || d.status === "READY" ? "success" : "warning"}>
                            {d.status === "ready" || d.status === "READY" ? "Ready" : "Partial"}
                          </Badge>
                          <button
                            type="button"
                            title="Delete dataset"
                            disabled={deletingId === d.id}
                            onClick={(e) => handleDelete(e, d.id)}
                            className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-[12.5px] text-muted-foreground leading-relaxed">
                        {d.description}
                      </p>
                      <div className="mt-4 flex items-center justify-between text-[12px] font-medium text-muted-foreground border-t border-border/40 pt-2.5">
                        <span>{formatNumber(d.recordCount)} records</span>
                        <span>{d.sourceCount} sources</span>
                        <span>{formatDate(d.updatedAt)}</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            ))}
          </div>

          <Pagination
            currentPage={safePage}
            totalPages={totalPages}
            totalItems={activeDatasets.length}
            pageSize={pageSize}
            itemLabel="datasets"
            onPageChange={(p) => setPage(p)}
          />
        </div>
      )}
    </div>
  );
}
