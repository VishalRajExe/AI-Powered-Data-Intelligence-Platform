"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { TreasureMapIcon, SpyglassIcon, SailingShipIcon } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/hooks/use-api";
import { formatNumber, formatRelativeTime } from "@/lib/utils";
import { useRouter } from "next/navigation";

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed" },
];

interface WorkflowItem {
  id: string;
  name: string;
  prompt: string;
  status: string;
  progress: number;
  validRecords: number;
  updatedAt: string;
  lastRun?: { id: string; status: string };
}

import type { WorkflowStatus } from "@/lib/types";

interface WorkflowListResponse {
  data: WorkflowItem[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

function mapStatusToFilter(w: WorkflowItem): WorkflowStatus {
  const runStatus = w.lastRun?.status;
  if (runStatus === "RUNNING") return "running";
  if (runStatus === "COMPLETED") return "completed";
  if (runStatus === "FAILED") return "failed";
  if (w.status === "ACTIVE") return "running";
  if (w.status === "ARCHIVED") return "completed";
  return "completed";
}

export default function WorkflowsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  const { data, loading } = useApi<WorkflowListResponse>(
    user ? "/workflows" : null,
    { workspaceId: user?.workspaceId ?? "", userId: user?.id ?? "", limit: 50, search: query || undefined },
    { skip: !user },
  );

  const workflows = data?.data ?? [];

  const filtered = useMemo(() => {
    return workflows.filter((w) => {
      if (filter === "all") return true;
      return mapStatusToFilter(w) === filter;
    });
  }, [filter, workflows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-tan mb-1">
            <TreasureMapIcon className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              NAVIGATION LOG
            </span>
          </div>
          <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            Workflows
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Research missions you&apos;ve initiated and their operational status.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => router.push("/dashboard/research/new")}
          className="bg-primary text-primary-foreground hover:bg-primary-hover font-semibold gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" /> New research
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v)}>
          <TabsList className="bg-surface border-border">
            {FILTERS.map((f) => (
              <TabsTrigger key={f.key} value={f.key} className="text-xs font-semibold">
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative w-full max-w-[240px]">
          <SpyglassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workflows…"
            className="h-8 pl-8 text-[13px] bg-card border-border/80"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-[140px] rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SailingShipIcon}
          title="No voyages found"
          description="Try a different filter or initiate a new research mission."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
          {filtered.map((w, i) => {
            const displayStatus = mapStatusToFilter(w);
            const isRunning = displayStatus === "running";
            return (
              <motion.div
                key={w.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <Link href={isRunning && w.lastRun ? `/dashboard/workflows/live?runId=${w.lastRun.id}&workflowId=${w.id}` : `/dashboard/workflows/${w.id}`}>
                  <Card className="h-full border-border bg-card transition-all hover:border-tan/60 hover:shadow-card">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[14px] font-semibold leading-snug text-foreground">{w.name}</p>
                        <StatusBadge status={displayStatus} />
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-[12.5px] text-muted-foreground leading-relaxed">
                        {w.prompt}
                      </p>
                      <div className="mt-3.5">
                        <Progress value={w.progress ?? (displayStatus === "completed" ? 100 : 0)} />
                      </div>
                      <div className="mt-3 flex items-center justify-between text-[12px] font-medium text-muted-foreground">
                        <span>{formatNumber(w.validRecords ?? 0)} valid records</span>
                        <span>{formatRelativeTime(w.updatedAt)}</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
