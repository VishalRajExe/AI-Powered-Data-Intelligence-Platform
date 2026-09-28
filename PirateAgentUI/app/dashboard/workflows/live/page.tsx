"use client";
import { useEffect, useState, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { WorkflowRunView } from "@/components/workflow/workflow-run-view";
import { useSSE } from "@/hooks/use-sse";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { STAGE_TEMPLATE } from "@/lib/constants";
import type { StageState, WorkflowStatus } from "@/lib/types";

interface RunResponse {
  id: string;
  workflowId: string;
  status: string;
  datasetId?: string;
  workflow?: { name: string; prompt: string };
}

function LiveWorkflowInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const runId = searchParams.get("runId");

  const [run, setRun] = useState<RunResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch initial run data
  useEffect(() => {
    if (!runId || !user) return;
    api
      .get<RunResponse>(`/runs/${runId}`, {
        workspaceId: user.workspaceId,
        userId: user.id,
      })
      .then(setRun)
      .catch(() => {
        // If we can't load the run, redirect back
        router.replace("/dashboard/workflows");
      })
      .finally(() => setLoading(false));
  }, [runId, user, router]);

  // Connect to SSE for live updates
  const { events } = useSSE({
    path: `/runs/${runId}/events`,
    query: {
      workspaceId: user?.workspaceId ?? "",
      userId: user?.id ?? "",
    },
    enabled: !!runId && !!user && !loading,
  });

  // Derive state from SSE events
  const derived = useMemo(() => {
    let status: WorkflowStatus = "running";
    let progress = 0;
    let recordsFound = 0;
    let validRecords = 0;
    let duplicates = 0;
    let sourcesProcessed = 0;
    let sourcesTotal = 0;
    let datasetId = run?.datasetId;

    const stages: StageState[] = STAGE_TEMPLATE.map((s) => ({
      ...s,
      status: "pending" as const,
    }));

    const log: { id: string; text: string; timestamp: string }[] = [];

    for (const ev of events) {
      const d = ev.data ?? {};

      switch (ev.action) {
        case "STAGE_STARTED": {
          const stageKey = d.stageKey as string;
          const idx = stages.findIndex((s) => s.key === stageKey);
          if (idx >= 0) stages[idx] = { ...stages[idx], status: "active" };
          log.push({ id: ev.id, text: `Started: ${d.label || stageKey}`, timestamp: ev.timestamp ?? new Date().toISOString() });
          break;
        }
        case "STAGE_COMPLETED": {
          const stageKey = d.stageKey as string;
          const idx = stages.findIndex((s) => s.key === stageKey);
          if (idx >= 0) stages[idx] = { ...stages[idx], status: "done" };
          progress = Math.min(100, ((idx + 1) / stages.length) * 100);
          log.push({ id: ev.id, text: `Completed: ${d.label || stageKey}`, timestamp: ev.timestamp ?? new Date().toISOString() });
          break;
        }
        case "RECORDS_COLLECTED":
          recordsFound = (d.totalRecords as number) ?? recordsFound + (d.count as number ?? 0);
          log.push({ id: ev.id, text: `Collected ${d.count ?? ""} records`, timestamp: ev.timestamp ?? new Date().toISOString() });
          break;
        case "SOURCE_DISCOVERED":
          sourcesTotal = (d.totalSources as number) ?? sourcesTotal + 1;
          log.push({ id: ev.id, text: `Discovered source: ${d.domain ?? d.url ?? ""}`, timestamp: ev.timestamp ?? new Date().toISOString() });
          break;
        case "SOURCE_PROCESSED":
          sourcesProcessed = (d.processedCount as number) ?? sourcesProcessed + 1;
          log.push({ id: ev.id, text: `Processed source: ${d.domain ?? d.url ?? ""}`, timestamp: ev.timestamp ?? new Date().toISOString() });
          break;
        case "SOURCE_FAILED":
          log.push({ id: ev.id, text: `Source failed: ${d.reason ?? d.url ?? ""}`, timestamp: ev.timestamp ?? new Date().toISOString() });
          break;
        case "VALIDATION_COMPLETED":
          validRecords = (d.validCount as number) ?? validRecords;
          log.push({ id: ev.id, text: `Validated ${d.validCount ?? ""} records`, timestamp: ev.timestamp ?? new Date().toISOString() });
          break;
        case "DEDUP_COMPLETED":
          duplicates = (d.duplicateCount as number) ?? duplicates;
          validRecords = (d.uniqueCount as number) ?? validRecords;
          log.push({ id: ev.id, text: `Removed ${d.duplicateCount ?? 0} duplicates`, timestamp: ev.timestamp ?? new Date().toISOString() });
          break;
        case "DATASET_CREATED":
          datasetId = (d.datasetId as string) ?? datasetId;
          log.push({ id: ev.id, text: `Dataset created`, timestamp: ev.timestamp ?? new Date().toISOString() });
          break;
        case "RUN_COMPLETED":
          status = "completed";
          progress = 100;
          datasetId = (d.datasetId as string) ?? datasetId;
          stages.forEach((s, i) => { stages[i] = { ...s, status: "done" }; });
          log.push({ id: ev.id, text: "Workflow completed", timestamp: ev.timestamp ?? new Date().toISOString() });
          break;
        case "RUN_FAILED":
          status = "failed";
          log.push({ id: ev.id, text: `Workflow failed: ${d.error ?? ""}`, timestamp: ev.timestamp ?? new Date().toISOString() });
          break;
        case "RUN_CANCELLED":
          status = "paused";
          log.push({ id: ev.id, text: "Workflow cancelled", timestamp: ev.timestamp ?? new Date().toISOString() });
          break;
        default:
          log.push({ id: ev.id, text: ev.action, timestamp: ev.timestamp ?? new Date().toISOString() });
      }
    }

    return { status, progress, recordsFound, validRecords, duplicates, sourcesProcessed, sourcesTotal, stages, log, datasetId };
  }, [events, run?.datasetId]);

  if (loading || !run) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleCancel = async () => {
    if (!runId || !user) return;
    try {
      await api.post(`/runs/${runId}/cancel`, {
        workspaceId: user.workspaceId,
        userId: user.id,
      });
    } catch {
      // Ignore cancel errors
    }
  };

  return (
    <WorkflowRunView
      name={run.workflow?.name ?? "Research"}
      prompt={run.workflow?.prompt ?? ""}
      status={derived.status}
      progress={derived.progress}
      stages={derived.stages}
      recordsFound={derived.recordsFound}
      validRecords={derived.validRecords}
      duplicates={derived.duplicates}
      sourcesProcessed={derived.sourcesProcessed}
      sourcesTotal={derived.sourcesTotal}
      log={derived.log.length > 0 ? derived.log : [{ id: "l0", text: "Workflow started", timestamp: new Date().toISOString() }]}
      datasetId={derived.status === "completed" ? derived.datasetId : undefined}
      isLive
      onPause={handleCancel}
    />
  );
}

export default function LiveWorkflowPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <LiveWorkflowInner />
    </Suspense>
  );
}
