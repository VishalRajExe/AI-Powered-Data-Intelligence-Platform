"use client";
import { useRouter } from "next/navigation";
import { Pause, Play, Square, ArrowRight, RotateCcw, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/common/status-badge";
import { StageChecklist } from "@/components/workflow/stage-checklist";
import { LiveStats } from "@/components/workflow/live-stats";
import { ActivityLog } from "@/components/workflow/activity-log";
import type { StageState, WorkflowStatus } from "@/lib/types";

export interface WorkflowRunViewProps {
  name: string;
  prompt: string;
  status: WorkflowStatus;
  progress: number;
  stages: StageState[];
  recordsFound: number;
  validRecords: number;
  duplicates: number;
  sourcesProcessed: number;
  sourcesTotal: number;
  log: { id: string; text: string; timestamp: string }[];
  datasetId?: string;
  isLive?: boolean;
  onPause?: () => void;
  onResume?: () => void;
}

export function WorkflowRunView(props: WorkflowRunViewProps) {
  const router = useRouter();
  const { name, prompt, status, progress, stages, log, datasetId, isLive, onPause, onResume } = props;
  const isPaused = status === "paused";

  return (
    <div className="space-y-6">
      <button
        onClick={() => router.push("/dashboard/workflows")}
        className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All workflows
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground md:text-3xl">
              {name}
            </h1>
            <StatusBadge status={status} />
          </div>
          <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
            {prompt}
          </p>
        </div>

        <div className="flex gap-2">
          {isLive && status === "running" && (
            <Button variant="secondary" size="sm" onClick={onPause}>
              <Pause className="h-3.5 w-3.5" /> Pause
            </Button>
          )}
          {isLive && isPaused && (
            <Button variant="secondary" size="sm" onClick={onResume}>
              <Play className="h-3.5 w-3.5" /> Resume
            </Button>
          )}
          {isLive && (status === "running" || isPaused) && (
            <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/workflows")}>
              <Square className="h-3.5 w-3.5" /> Stop
            </Button>
          )}
          {status === "failed" && (
            <Button variant="secondary" size="sm">
              <RotateCcw className="h-3.5 w-3.5" /> Retry
            </Button>
          )}
          {status === "completed" && (
            <Button
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary-hover font-semibold gap-1.5"
              onClick={() => router.push(datasetId ? `/dashboard/datasets/${datasetId}` : "/dashboard/datasets")}
            >
              View results <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <Card className="border-border bg-card shadow-subtle">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between text-[12.5px]">
            <span className="font-medium text-muted-foreground">Mission progress</span>
            <span className="font-serif text-base font-bold text-foreground">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1.4fr]">
        <Card className="border-border bg-card shadow-subtle">
          <CardContent className="p-5">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Mission Pipeline
            </p>
            <StageChecklist stages={stages} />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <LiveStats
            recordsFound={props.recordsFound}
            validRecords={props.validRecords}
            duplicates={props.duplicates}
            sourcesProcessed={props.sourcesProcessed}
            sourcesTotal={props.sourcesTotal}
          />
          <Card className="border-border bg-card shadow-subtle">
            <CardContent className="p-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Activity Log
              </p>
              <ActivityLog items={log} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
