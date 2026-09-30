import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TreasureMapIcon, SailingShipIcon } from "@/components/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime, plural } from "@/lib/utils";import type { WorkflowSummary } from "@/lib/api/types";

/**
 * The four newest workflows.
 *
 * The badges carry the workflow's own two persisted states — `planningStatus` and `status` — and not
 * a run status. A workflow row has no live run to report; the previous build's card read
 * `lastRun.status` off a joined record and labelled the workflow with it, which made a definition
 * look like an activity.
 */
export function RecentWorkflows({ workflows, loading }: { workflows: WorkflowSummary[]; loading?: boolean }) {
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
          workflows.map((w) => (
            <Link
              key={w.id}
              href={`/dashboard/workflows/${w.id}`}
              className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-surface border-b border-border/30 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-semibold text-foreground">{w.name}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {plural(w.runCount ?? 0, "run")} · {formatRelativeTime(w.updatedAt ?? w.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <PlanningBadge status={w.planningStatus} />
                {w.status !== "DRAFT" && (
                  <Badge variant="default" className="hidden lg:inline-flex">
                    {w.status}
                  </Badge>
                )}
              </div>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function PlanningBadge({ status }: { status: string }) {
  const variant =
    status === "PLANNED" ? "success" : status === "FAILED" ? "danger" : status === "PLANNING" ? "info" : "default";
  return <Badge variant={variant}>{status}</Badge>;
}
