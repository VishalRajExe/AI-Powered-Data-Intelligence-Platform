"use client";
import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ShipLogIcon, SpyglassIcon } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/hooks/use-api";
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

  const { data, loading } = useApi<DatasetListResponse>(
    user ? "/datasets" : null,
    { workspaceId: user?.workspaceId ?? "", userId: user?.id ?? "", limit: 50, search: query || undefined },
    { skip: !user },
  );

  const datasets: DatasetItem[] = data?.data ?? (data as any)?.items ?? [];

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
            onChange={(e) => setQuery(e.target.value)}
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
      ) : datasets.length === 0 ? (
        <EmptyState
          icon={ShipLogIcon}
          title="No datasets yet"
          description="Completed research missions will store verified records here."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
          {datasets.map((d, i) => (
            <motion.div
              key={d.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <Link href={`/dashboard/datasets/${d.id}`}>
                <Card className="h-full border-border bg-card transition-all hover:border-tan/60 hover:shadow-card">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[14px] font-semibold leading-snug text-foreground">{d.name}</p>
                      <Badge variant={d.status === "ready" || d.status === "READY" ? "success" : "warning"}>
                        {d.status === "ready" || d.status === "READY" ? "Ready" : "Partial"}
                      </Badge>
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
      )}
    </div>
  );
}
