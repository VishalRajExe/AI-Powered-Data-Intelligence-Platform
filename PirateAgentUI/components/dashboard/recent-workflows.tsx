import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TreasureMapIcon, SailingShipIcon } from "@/components/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime, formatNumber } from "@/lib/utils";

interface WorkflowItem {
  id: string;
  name: string;
  status: string;
  validRecords?: number;
  updatedAt: string;
  lastRun?: { status: string };
}

export function RecentWorkflows({ workflows, loading }: { workflows: WorkflowItem[]; loading?: boolean }) {
  return (
    <Card className="border-border bg-card shadow-subtle">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <TreasureMapIcon className="h-4 w-4 text-tan" />
          <CardTitle className="font-serif text-lg font-bold tracking-tight text-foreground">
            Recent workflows
          </CardTitle>
        </div>
        <Link
          href="/dashboard/workflows"
          className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-0.5 pt-2">
        {loading ? (
          <div className="space-y-2 py-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 rounded-md" />
            ))}
          </div>
        ) : workflows.length === 0 ? (
          <EmptyState
            icon={SailingShipIcon}
            title="No voyages yet"
            description="Start a research mission and PirateAgent will collect the data for you."
          />
        ) : (
          workflows.map((w) => {
            // Map backend status to frontend badge status
            const displayStatus = mapWorkflowStatus(w);
            return (
              <Link
                key={w.id}
                href={`/dashboard/workflows/${w.id}`}
                className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-surface border-b border-border/30 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold text-foreground">{w.name}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {formatNumber(w.validRecords ?? 0)} records · {formatRelativeTime(w.updatedAt)}
                  </p>
                </div>
                <StatusBadge status={displayStatus} />
              </Link>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

import type { WorkflowStatus } from "@/lib/types";

function mapWorkflowStatus(w: WorkflowItem): WorkflowStatus {
  // Backend uses ACTIVE/DRAFT/PAUSED/ARCHIVED for workflow, RUNNING/COMPLETED/FAILED for runs
  const runStatus = w.lastRun?.status;
  if (runStatus === "RUNNING") return "running";
  if (runStatus === "COMPLETED") return "completed";
  if (runStatus === "FAILED") return "failed";
  if (w.status === "ACTIVE") return "running";
  if (w.status === "ARCHIVED") return "completed";
  if (w.status === "PAUSED") return "paused";
  return "completed";
}
