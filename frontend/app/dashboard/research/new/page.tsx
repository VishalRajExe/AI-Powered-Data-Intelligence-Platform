"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2, Pencil } from "lucide-react";
import { SpyglassIcon, CompassIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { PlanPreview } from "@/components/research/plan-preview";
import { ReadError } from "@/components/common/read-error";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api/client";
import { workflows } from "@/lib/api/endpoints";
import type { PlanView, WorkflowSummary } from "@/lib/api/types";

type Stage = "input" | "planning" | "review" | "starting";

/**
 * Prompt → workflow → stored plan → run.
 *
 * Two separate POSTs, because that is what the backend is: creating a workflow stores the prompt,
 * and planning it is the call that asks the AI service for a requirement and lets Spring validate
 * the answer. A planning failure therefore leaves a real, inspectable workflow behind rather than a
 * half-drawn preview.
 */
function NewResearchInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canWrite, status } = useAuth();

  const [prompt, setPrompt] = useState(searchParams.get("prompt") ?? "");
  const [stage, setStage] = useState<Stage>("input");
  const [workflow, setWorkflow] = useState<WorkflowSummary | null>(null);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const analyze = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 8) {
      setError(new ApiError("A prompt needs at least 8 characters.", { code: "PROMPT_TOO_SHORT" }));
      return;
    }
    setStage("planning");
    setError(null);
    setPlan(null);
    try {
      const created = await workflows.create({ prompt: trimmed });
      setWorkflow(created.workflow);
      const planned = await workflows.plan(created.workflow.id);
      setPlan(planned.plan);
      setWorkflow(planned.workflow);
      setStage("review");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : new ApiError(String(cause), { code: "UNEXPECTED" }));
      setStage("input");
    }
  }, []);

  async function startCollection() {
    if (!workflow) return;
    setStage("starting");
    setError(null);
    try {
      const started = await workflows.startRun(workflow.id);
      router.push(`/dashboard/workflows/${workflow.id}?run=${started.run.id}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : new ApiError(String(cause), { code: "UNEXPECTED" }));
      setStage("review");
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <button
        onClick={() => router.push("/dashboard")}
        className="mb-4 flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
      </button>

      {error && <ReadError error={error} label="Request failed" onRetry={() => setError(null)} />}

      {status === "authenticated" && !canWrite && (
        <Card className="mb-4 border-warning/40">
          <CardContent className="pt-5 text-[12.5px] leading-relaxed text-muted-foreground">
            This workspace role can read but cannot start work, so the buttons below will be refused
            with <span className="font-mono text-[12px]">WORKSPACE_WRITE_FORBIDDEN</span>.
          </CardContent>
        </Card>
      )}

      {stage === "input" && (
        <div className="animate-fade-in">
          <div className="mb-2 flex items-center gap-2 text-tan">
            <SpyglassIcon className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              MISSION BRIEF
            </span>
          </div>
          <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            New research request
          </h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground leading-relaxed">
            Describe the data you need in plain English — PirateAgent will chart the course and collect it.
          </p>
          <Textarea
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Find 200 AI startups in India with founder, website, funding and LinkedIn"
            rows={4}
            className="mt-4 text-[14px] bg-card border-border text-foreground"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) analyze(prompt);
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-[11.5px] text-muted-foreground">
              {prompt.trim().length} characters · minimum 8, maximum 4000
            </p>
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary-hover font-semibold"
              onClick={() => analyze(prompt)}
              disabled={prompt.trim().length < 8}
            >
              Plan this request <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {stage === "planning" && (
        <div className="flex flex-col items-center rounded-xl border border-border bg-card py-16 text-center shadow-subtle animate-fade-in">
          <div className="relative flex h-14 w-14 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-tan/20" />
            <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-surface border border-border text-tan">
              <CompassIcon className="h-6 w-6 animate-spin" style={{ animationDuration: "6s" }} />
            </span>
          </div>
          <p className="mt-4 font-serif text-lg font-bold text-foreground">Planning research trajectory</p>
          <p className="mt-1 max-w-sm text-[13px] text-muted-foreground leading-relaxed">
            The prompt is stored as a workflow. The AI service proposes a requirement and extraction
            schema, and Spring validates both before a plan is written.
          </p>
        </div>
      )}

      {(stage === "review" || stage === "starting") && plan && workflow && (
        <div className="animate-fade-in">
          <div className="mb-5 flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-xs">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-tan">
                <SpyglassIcon className="h-3.5 w-3.5" />
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Your request
                </p>
              </div>
              <p className="mt-1 text-[13.5px] font-medium leading-snug text-foreground break-words">
                {workflow.requirementText}
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                workflow {workflow.id} · {workflow.status}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setStage("input");
                setPlan(null);
              }}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground transition-colors"
              title="Editing the prompt starts a new workflow: a plan is derived from the prompt stored with it"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>

          <PlanPreview plan={plan} />

          <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
            Nothing has been collected: the plan is stored, and collection starts when the run does.
            {workflow.planningStatus === "FAILED" && " This workflow's last planning attempt failed."}
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5">
            <Button variant="secondary" onClick={() => setStage("input")}>
              Edit prompt
            </Button>
            <Button
              onClick={startCollection}
              loading={stage === "starting"}
              disabled={!canWrite}
              className="bg-primary text-primary-foreground hover:bg-primary-hover font-semibold"
            >
              {stage === "starting" ? "Starting…" : (
                <>
                  Start collection <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NewResearchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <NewResearchInner />
    </Suspense>
  );
}
