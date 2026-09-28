"use client";
import { useRouter } from "next/navigation";
import { Eye, RotateCcw } from "lucide-react";
import { HistoryScrollIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/hooks/use-api";
import { formatDate, formatNumber } from "@/lib/utils";
import type { WorkflowStatus } from "@/lib/types";

function formatDuration(sec?: number) {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

interface WorkflowItem {
  id: string;
  name: string;
  prompt: string;
  status: string;
  validRecords: number;
  durationSec?: number;
  sourcesProcessed?: number;
  createdAt: string;
  lastRun?: { status: string; durationMs?: number; sourcesProcessed?: number };
}

interface WorkflowListResponse {
  data: WorkflowItem[];
  pagination: { total: number };
}

export default function HistoryPage() {
  const router = useRouter();
  const { user } = useAuth();

  const { data, loading } = useApi<WorkflowListResponse>(
    user ? "/workflows" : null,
    { workspaceId: user?.workspaceId ?? "", userId: user?.id ?? "", limit: 50 },
    { skip: !user },
  );

  const workflows = data?.data ?? [];
  const past = workflows.filter((w) => {
    const runStatus = w.lastRun?.status;
    return runStatus === "COMPLETED" || runStatus === "FAILED" || w.status === "ARCHIVED";
  });

  function mapStatus(w: WorkflowItem): WorkflowStatus {
    const rs = w.lastRun?.status;
    if (rs === "COMPLETED") return "completed";
    if (rs === "FAILED") return "failed";
    return "completed";
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-tan mb-1">
          <HistoryScrollIcon className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            EXPEDITION ARCHIVE
          </span>
        </div>
        <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground md:text-3xl">
          History
        </h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Historical log of completed voyages, datasets generated, and execution times.
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : past.length === 0 ? (
        <EmptyState
          icon={HistoryScrollIcon}
          title="No history yet"
          description="Completed and archived research voyages will appear here."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-subtle">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-surface/90 border-b border-border">
              <tr>
                <th className="px-3.5 py-3 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">Workflow</th>
                <th className="px-3.5 py-3 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="px-3.5 py-3 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">Records</th>
                <th className="px-3.5 py-3 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">Sources</th>
                <th className="px-3.5 py-3 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">Duration</th>
                <th className="px-3.5 py-3 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">Date</th>
                <th className="px-3.5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {past.map((w) => (
                <tr key={w.id} className="transition-colors hover:bg-surface/60">
                  <td className="px-3.5 py-3">
                    <p className="max-w-[240px] truncate font-semibold text-foreground">{w.name}</p>
                    <p className="max-w-[240px] truncate text-[12px] text-muted-foreground">{w.prompt}</p>
                  </td>
                  <td className="px-3.5 py-3">
                    <StatusBadge status={mapStatus(w)} />
                  </td>
                  <td className="px-3.5 py-3 font-medium text-foreground">{formatNumber(w.validRecords ?? 0)}</td>
                  <td className="px-3.5 py-3 text-muted-foreground">{w.lastRun?.sourcesProcessed ?? w.sourcesProcessed ?? 0}</td>
                  <td className="px-3.5 py-3 text-muted-foreground">
                    {w.lastRun?.durationMs
                      ? formatDuration(Math.round(w.lastRun.durationMs / 1000))
                      : formatDuration(w.durationSec)}
                  </td>
                  <td className="px-3.5 py-3 text-muted-foreground">{formatDate(w.createdAt)}</td>
                  <td className="px-3.5 py-3">
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7 bg-card border-border/80"
                        onClick={() => router.push(`/dashboard/workflows/${w.id}`)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7 bg-card border-border/80"
                        onClick={() => router.push(`/dashboard/research/new?prompt=${encodeURIComponent(w.prompt)}`)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
