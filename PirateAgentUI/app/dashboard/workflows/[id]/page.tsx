"use client";
import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { Loader2 } from "lucide-react";
import { WorkflowRunView } from "@/components/workflow/workflow-run-view";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { STAGE_TEMPLATE } from "@/lib/constants";
import type { StageState } from "@/lib/types";

interface WorkflowDetail {
  id: string;
  name: string;
  prompt: string;
  status: string;
  lastRun?: {
    id: string;
    status: string;
    progress?: number;
    recordsFound?: number;
    validRecords?: number;
    duplicates?: number;
    sourcesProcessed?: number;
    sourcesTotal?: number;
    datasetId?: string;
  };
  totalRuns?: number;
}

interface ActivityEvent {
  id: string;
  action: string;
  message?: string;
  timestamp: string;
}

export default function WorkflowDetailPage({ params }: { params: { id: string } }) {
  const { user } = useAuth();
  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    Promise.all([
      api.get<WorkflowDetail>(`/workflows/${params.id}`, {
        workspaceId: user.workspaceId,
        userId: user.id,
      }),
      // Try to load activity from the last run if available
      api.get<WorkflowDetail>(`/workflows/${params.id}`, {
        workspaceId: user.workspaceId,
        userId: user.id,
      }).then(async (wf) => {
        if (wf.lastRun?.id) {
          try {
            const result = await api.get<{ events: ActivityEvent[] }>(`/runs/${wf.lastRun.id}/activity`, {
              workspaceId: user.workspaceId,
              userId: user.id,
            });
            return result.events ?? [];
          } catch {
            return [];
          }
        }
        return [];
      }),
    ])
      .then(([wf, events]) => {
        setWorkflow(wf);
        setActivity(events);
      })
      .catch(() => {
        // Workflow not found
        setWorkflow(null);
      })
      .finally(() => setLoading(false));
  }, [params.id, user]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!workflow) return notFound();

  const run = workflow.lastRun;
  const status = run?.status === "RUNNING" ? "running"
    : (run?.status === "COMPLETED" || run?.status === "PARTIAL") ? "completed"
    : run?.status === "FAILED" ? "failed"
    : "completed";

  const progress = run?.progress ?? (status === "completed" ? 100 : 0);

  const stages: StageState[] = STAGE_TEMPLATE.map((s) => ({
    ...s,
    status: status === "completed" ? "done" as const : "pending" as const,
  }));

  const log = activity.length > 0
    ? activity.map((a: any) => ({
        id: a.id,
        text: a.message ?? a.action,
        timestamp: a.timestamp ?? a.createdAt ?? new Date().toISOString(),
      }))
    : [{ id: "l0", text: "Workflow created", timestamp: new Date().toISOString() }];

  const datasetId = run?.datasetId ?? (workflow as any)?.dataset?.id;
  const recordsFound = run?.recordsFound ?? (workflow as any)?.dataset?.recordCount ?? 0;
  const validRecords = run?.validRecords ?? (run as any)?.recordsAccepted ?? (workflow as any)?.dataset?.validCount ?? 0;
  const duplicates = run?.duplicates ?? (run as any)?.duplicateCount ?? (workflow as any)?.dataset?.duplicateCount ?? 0;
  const sourcesProcessed = run?.sourcesProcessed ?? (run as any)?.sourceCount ?? (workflow as any)?.dataset?.sourceCount ?? 0;
  const sourcesTotal = run?.sourcesTotal ?? Math.max(sourcesProcessed, 1);

  return (
    <WorkflowRunView
      name={workflow.name}
      prompt={workflow.prompt ?? (workflow as any).requirement ?? ""}
      status={status}
      progress={progress}
      stages={stages}
      recordsFound={recordsFound}
      validRecords={validRecords}
      duplicates={duplicates}
      sourcesProcessed={sourcesProcessed}
      sourcesTotal={sourcesTotal}
      log={log}
      datasetId={datasetId}
    />
  );
}
