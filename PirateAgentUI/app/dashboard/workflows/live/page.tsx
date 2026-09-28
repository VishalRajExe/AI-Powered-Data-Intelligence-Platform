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
  progress?: number;
  recordsFound?: number;
  recordsValid?: number;
  duplicateCount?: number;
  sourcesProcessed?: number;
  sourcesTotal?: number;
  datasetId?: string;
  workflow?: { name: string; prompt: string };
  errorMessage?: string;
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
    const isCompleted = run?.status === "COMPLETED";
    const isFailed = run?.status === "FAILED";
    const isCancelled = run?.status === "CANCELLED";

    let status: WorkflowStatus = isCompleted ? "completed" : isFailed ? "failed" : isCancelled ? "paused" : "running";
    let progress = isCompleted ? 100 : (run?.progress ?? 0);
    let recordsFound = run?.recordsFound ?? 0;
    let validRecords = run?.recordsValid ?? 0;
    let duplicates = run?.duplicateCount ?? 0;
    let sourcesProcessed = run?.sourcesProcessed ?? 0;
    let sourcesTotal = run?.sourcesTotal ?? sourcesProcessed;
    let datasetId = run?.datasetId;

    const stages: StageState[] = STAGE_TEMPLATE.map((s, idx) => {
      if (isCompleted) return { ...s, status: "done" as const };
      return { ...s, status: idx === 0 ? ("done" as const) : ("pending" as const) };
    });

    const setStage = (key: StageState["key"], st: StageState["status"]) => {
      const idx = stages.findIndex((s) => s.key === key);
      if (idx >= 0) {
        stages[idx] = { ...stages[idx], status: st };
        if (st === "done") {
          for (let i = 0; i < idx; i++) {
            stages[i] = { ...stages[i], status: "done" };
          }
          progress = Math.max(progress, Math.min(100, Math.round(((idx + 1) / stages.length) * 100)));
        }
      }
    };

    const log: { id: string; text: string; timestamp: string }[] = [];

    // Prompt brief
    if (run?.workflow?.prompt) {
      log.push({
        id: "init-prompt",
        text: `Understood requirement: "${run.workflow.prompt.slice(0, 80)}"`,
        timestamp: new Date().toISOString(),
      });
    }

    for (const ev of events) {
      const d = ev.data ?? {};
      const ts = ev.timestamp ?? new Date().toISOString();

      switch (ev.action) {
        case "STAGE_STARTED": {
          const stageKey = d.stageKey as StageState["key"];
          setStage(stageKey, "active");
          log.push({ id: ev.id, text: `Started: ${d.label || stageKey}`, timestamp: ts });
          break;
        }
        case "STAGE_COMPLETED": {
          const stageKey = d.stageKey as StageState["key"];
          setStage(stageKey, "done");
          log.push({ id: ev.id, text: `Completed: ${d.label || stageKey}`, timestamp: ts });
          break;
        }
        case "SOURCE_DISCOVERY_STARTED":
          setStage("understand", "done");
          setStage("discover", "active");
          log.push({ id: ev.id, text: "Discovering permitted sources...", timestamp: ts });
          break;
        case "SOURCE_DISCOVERED": {
          setStage("discover", "done");
          const count = (d.sourceCount as number) ?? (Array.isArray(d.sources) ? d.sources.length : 1);
          sourcesTotal = Math.max(sourcesTotal, count);
          log.push({ id: ev.id, text: `Discovered source: ${d.domain ?? d.url ?? `${count} sources`}`, timestamp: ts });
          break;
        }
        case "SCRAPE_STARTED":
          setStage("discover", "done");
          setStage("collect", "active");
          log.push({ id: ev.id, text: "Collecting source contents...", timestamp: ts });
          break;
        case "SCRAPE_COMPLETED":
        case "SOURCE_PROCESSED": {
          setStage("collect", "done");
          const count = (d.sourceCount as number) ?? (d.processedCount as number) ?? sourcesProcessed + 1;
          sourcesProcessed = Math.max(sourcesProcessed, count);
          log.push({ id: ev.id, text: `Collected data from ${sourcesProcessed} sources`, timestamp: ts });
          break;
        }
        case "EXTRACTION_STARTED":
          setStage("collect", "done");
          setStage("extract", "active");
          log.push({ id: ev.id, text: "Extracting structured fields...", timestamp: ts });
          break;
        case "RECORDS_EXTRACTED":
        case "RECORDS_COLLECTED": {
          setStage("extract", "done");
          const count = (d.recordCount as number) ?? (d.totalRecords as number) ?? recordsFound;
          recordsFound = Math.max(recordsFound, count);
          log.push({ id: ev.id, text: `Extracted ${recordsFound} candidate records`, timestamp: ts });
          break;
        }
        case "VALIDATION_COMPLETED": {
          setStage("validate", "done");
          const count = (d.validCount as number) ?? (d.validRecordCount as number) ?? validRecords;
          validRecords = count;
          log.push({ id: ev.id, text: `Validated records (${validRecords} valid)`, timestamp: ts });
          break;
        }
        case "DEDUPLICATION_COMPLETED":
        case "DEDUP_COMPLETED": {
          setStage("dedupe", "done");
          duplicates = (d.duplicateCount as number) ?? duplicates;
          log.push({ id: ev.id, text: `Removed ${duplicates} duplicate records`, timestamp: ts });
          break;
        }
        case "DATASET_CREATED":
          setStage("build", "done");
          datasetId = (d.datasetId as string) ?? datasetId;
          log.push({ id: ev.id, text: "Dataset created", timestamp: ts });
          break;
        case "RUN_COMPLETED":
          status = "completed";
          progress = 100;
          datasetId = (d.datasetId as string) ?? datasetId;
          stages.forEach((s, i) => { stages[i] = { ...s, status: "done" }; });
          log.push({ id: ev.id, text: "Workflow completed", timestamp: ts });
          break;
        case "RUN_FAILED": {
          status = "failed";
          const errDetail = d.error || d.errorMessage || d.message || d.errorCode || run?.errorMessage || "Execution error";
          log.push({ id: ev.id, text: `Workflow failed: ${errDetail}`, timestamp: ts });
          break;
        }
        case "RUN_CANCELLED":
          status = "paused";
          log.push({ id: ev.id, text: "Workflow cancelled", timestamp: ts });
          break;
        default:
          log.push({ id: ev.id, text: String(ev.action).replace(/_/g, " ").toLowerCase(), timestamp: ts });
      }
    }

    return { status, progress, recordsFound, validRecords, duplicates, sourcesProcessed, sourcesTotal, stages, log, datasetId };
  }, [events, run]);

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
