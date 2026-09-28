"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ShipWheelIcon,
  LighthouseIcon,
  TreasureChestIcon,
  AnchorCheckIcon,
  TreasureMapIcon,
  ShipLogIcon,
  CargoIcon,
} from "@/components/icons";
import { EmptyState } from "@/components/common/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatRelativeTime, cn } from "@/lib/utils";

interface ActivityEvent {
  id: string;
  action: string;
  message?: string;
  timestamp?: string;
  createdAt?: string;
  details?: Record<string, unknown> | null;
  workflowId?: string;
  runId?: string;
}

const ICON_MAP: Record<string, React.ElementType> = {
  start: ShipWheelIcon,
  source: LighthouseIcon,
  collect: TreasureChestIcon,
  validate: AnchorCheckIcon,
  dedupe: TreasureMapIcon,
  dataset: ShipLogIcon,
  export: CargoIcon,
  // Backend event mappings
  RUN_STARTED: ShipWheelIcon,
  SOURCE_DISCOVERY_STARTED: LighthouseIcon,
  SOURCE_DISCOVERED: LighthouseIcon,
  SOURCE_PROCESSED: LighthouseIcon,
  SCRAPE_STARTED: TreasureChestIcon,
  SCRAPE_COMPLETED: TreasureChestIcon,
  EXTRACTION_STARTED: CargoIcon,
  RECORDS_EXTRACTED: TreasureChestIcon,
  RECORDS_COLLECTED: TreasureChestIcon,
  VALIDATION_COMPLETED: AnchorCheckIcon,
  DEDUPLICATION_COMPLETED: TreasureMapIcon,
  DEDUP_COMPLETED: TreasureMapIcon,
  DATASET_CREATED: ShipLogIcon,
  RUN_COMPLETED: ShipWheelIcon,
  RUN_FAILED: ShipWheelIcon,
  STAGE_STARTED: ShipWheelIcon,
  STAGE_COMPLETED: ShipWheelIcon,
};

const TONE_MAP: Record<string, string> = {
  start: "bg-surface text-tan border border-border",
  source: "bg-surface text-muted-foreground border border-border",
  collect: "bg-surface text-primary border border-border",
  validate: "bg-success-soft text-success border border-success/30",
  dedupe: "bg-warning-soft text-warning border border-warning/30",
  dataset: "bg-surface text-primary border border-border",
  export: "bg-surface text-tan border border-border",
  RUN_STARTED: "bg-surface text-tan border border-border",
  SOURCE_DISCOVERY_STARTED: "bg-surface text-muted-foreground border border-border",
  SOURCE_DISCOVERED: "bg-surface text-muted-foreground border border-border",
  SOURCE_PROCESSED: "bg-surface text-muted-foreground border border-border",
  SCRAPE_STARTED: "bg-surface text-primary border border-border",
  SCRAPE_COMPLETED: "bg-surface text-primary border border-border",
  EXTRACTION_STARTED: "bg-surface text-tan border border-border",
  RECORDS_EXTRACTED: "bg-surface text-primary border border-border",
  RECORDS_COLLECTED: "bg-surface text-primary border border-border",
  VALIDATION_COMPLETED: "bg-success-soft text-success border border-success/30",
  DEDUPLICATION_COMPLETED: "bg-warning-soft text-warning border border-warning/30",
  DEDUP_COMPLETED: "bg-warning-soft text-warning border border-warning/30",
  DATASET_CREATED: "bg-surface text-primary border border-border",
  RUN_COMPLETED: "bg-success-soft text-success border border-success/30",
  RUN_FAILED: "bg-danger-soft text-danger border border-danger/30",
  STAGE_STARTED: "bg-surface text-tan border border-border",
  STAGE_COMPLETED: "bg-surface text-tan border border-border",
};

function formatActionMessage(ev: ActivityEvent): string {
  if (ev.message) return ev.message;
  const d = ev.details as any;
  if (d && typeof d === "object" && typeof d.message === "string") return d.message;

  switch (ev.action) {
    case "RUN_STARTED": return "Workflow mission initiated";
    case "STAGE_STARTED": return `Stage started: ${d?.stage ?? "Processing"}`;
    case "STAGE_COMPLETED": return `Stage completed: ${d?.stage ?? "Processing"}`;
    case "SOURCE_DISCOVERY_STARTED": return "Discovering permitted sources...";
    case "SOURCE_DISCOVERED": return `Discovered source: ${d?.url ?? d?.domain ?? "1 source"}`;
    case "SCRAPE_STARTED": return "Collecting source contents...";
    case "SCRAPE_COMPLETED":
    case "SOURCE_PROCESSED": return "Collected data from sources";
    case "EXTRACTION_STARTED": return "Extracting structured fields...";
    case "RECORDS_EXTRACTED":
    case "RECORDS_COLLECTED": return `Extracted ${d?.recordCount ?? d?.totalRecords ?? "data"} candidate records`;
    case "VALIDATION_COMPLETED": return `Validated records (${d?.validCount ?? d?.validRecordCount ?? d?.valid ?? 0} valid)`;
    case "DEDUPLICATION_COMPLETED":
    case "DEDUP_COMPLETED": return `Removed ${d?.duplicateCount ?? d?.duplicates ?? 0} duplicate records`;
    case "DATASET_CREATED": return "Dataset created and ready";
    case "RUN_COMPLETED": return "Workflow completed successfully";
    case "RUN_FAILED": return `Workflow failed: ${d?.errorMessage ?? d?.error ?? "Execution error"}`;
    default: return ev.action.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }
}

export default function ActivityPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    // Get recent workflows and their activity
    api
      .get<any>("/workflows", {
        workspaceId: user.workspaceId,
        userId: user.id,
        limit: 10,
      })
      .then(async (wfRes) => {
        const allEvents: ActivityEvent[] = [];
        const workflows = wfRes?.data ?? wfRes?.items ?? [];

        for (const wf of workflows) {
          const runId = wf.lastRun?.id;
          if (!runId) continue;
          try {
            const actRes = await api.get<{ events: ActivityEvent[] }>(`/runs/${runId}/activity`, {
              workspaceId: user.workspaceId,
              userId: user.id,
            });
            for (const ev of actRes?.events ?? []) {
              const ts = ev.timestamp || ev.createdAt || new Date().toISOString();
              allEvents.push({
                ...ev,
                timestamp: ts,
                message: formatActionMessage(ev),
                workflowId: wf.id,
              });
            }
          } catch {
            // Skip failed activity fetches
          }
        }

        // Sort by timestamp descending
        allEvents.sort((a, b) => new Date(b.timestamp!).getTime() - new Date(a.timestamp!).getTime());
        setEvents(allEvents.slice(0, 50));
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [user]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-tan mb-1">
          <ShipWheelIcon className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            COMMAND LOG
          </span>
        </div>
        <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground md:text-3xl">
          Activity
        </h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Live stream of operational events, extractions, and validations across active missions.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={ShipWheelIcon}
          title="No activity yet"
          description="Actions across your research missions will stream here in real time."
        />
      ) : (
        <div className="rounded-xl border border-border bg-card p-6 shadow-subtle">
          <ol className="space-y-1">
            {events.map((item, i) => {
              const iconKey = item.action;
              const Icon = ICON_MAP[iconKey] ?? ShipWheelIcon;
              const tone = TONE_MAP[iconKey] ?? "bg-surface text-tan border border-border";
              const text = item.message ?? item.action;

              const content = (
                <div className="flex items-start gap-3.5">
                  <div className="flex flex-col items-center">
                    <span className={cn("flex h-8 w-8 items-center justify-center rounded-full shadow-xs", tone)}>
                      <Icon className="h-4 w-4" />
                    </span>
                    {i < events.length - 1 && <span className="mt-1 h-full min-h-[24px] w-px flex-1 bg-border/80" />}
                  </div>
                  <div className="flex-1 pb-5">
                    <p className="text-[13.5px] font-medium text-foreground">{text}</p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">{formatRelativeTime(item.timestamp || item.createdAt || new Date().toISOString())}</p>
                  </div>
                </div>
              );

              return (
                <li key={item.id}>
                  {item.workflowId ? (
                    <Link
                      href={`/dashboard/workflows/${item.workflowId}`}
                      className="block rounded-lg p-1.5 transition-colors hover:bg-surface"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="p-1.5">{content}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
