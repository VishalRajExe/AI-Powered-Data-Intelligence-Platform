"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, Pencil } from "lucide-react";
import { SpyglassIcon, CompassIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PlanPreview } from "@/components/research/plan-preview";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import type { DataContract } from "@/lib/types";

type Stage = "input" | "analyzing" | "review";

interface RawField {
  name?: string;
  key?: string;
  label?: string;
  type: string;
  required?: boolean;
}

interface ParseResponse {
  entity?: string;
  fields?: RawField[];
  filters?: (string | { field?: string; operator?: string; value?: unknown })[];
  sourceTypes?: string[];
  targetCount?: number;
  dataContractName?: string;
  parsedRequirement?: {
    entityType?: string;
    quantity?: number;
    fields?: RawField[];
    requiredFields?: string[];
    filters?: Array<string | { field?: string; operator?: string; value?: unknown }>;
    sourcePreferences?: string[];
    constraints?: string[];
  };
}

interface ExecuteResponse {
  workflowId: string;
  runId: string;
}

function normalizeFieldType(type: string): "text" | "url" | "number" | "email" {
  const lower = (type || "text").toLowerCase();
  if (lower === "url" || lower === "link" || lower === "website") return "url";
  if (lower === "number" || lower === "integer" || lower === "float") return "number";
  if (lower === "email") return "email";
  return "text";
}

function NewResearchInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const initialPrompt = searchParams.get("prompt") ?? "";

  const [prompt, setPrompt] = useState(initialPrompt);
  const [stage, setStage] = useState<Stage>(initialPrompt ? "analyzing" : "input");
  const [contract, setContract] = useState<DataContract | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Call the real requirements/parse endpoint
  useEffect(() => {
    if (stage !== "analyzing") return;
    setError(null);

    let cancelled = false;

    api
      .post<ParseResponse>("/requirements/parse", { prompt })
      .then((result) => {
        if (cancelled) return;
        const req = result.parsedRequirement;
        const entity = req?.entityType || result.entity || "Record";
        const rawFields = req?.fields || result.fields || [];
        const requiredSet = new Set(req?.requiredFields || []);

        const mappedFields = rawFields.map((f) => {
          const fieldName = f.name || f.key || f.label || "field";
          const isRequired =
            f.required !== undefined
              ? f.required
              : requiredSet.size > 0
              ? requiredSet.has(fieldName) || requiredSet.has(f.key || "")
              : true;
          return {
            name: fieldName,
            type: normalizeFieldType(f.type),
            required: isRequired,
          };
        });

        const rawFilters = req?.filters || result.filters || [];
        const filtersList = rawFilters
          .map((fl) =>
            typeof fl === "string"
              ? fl
              : `${fl.field ?? ""} ${fl.operator ?? ""} ${fl.value ?? ""}`.trim(),
          )
          .filter(Boolean)
          .concat(req?.constraints || []);

        const sourceTypes = req?.sourcePreferences || result.sourceTypes || [];
        const targetCount = req?.quantity || result.targetCount || 100;

        setContract({
          entity,
          fields: mappedFields.length > 0 ? mappedFields : [
            { name: "name", type: "text", required: true },
            { name: "website", type: "url", required: true },
          ],
          filters: filtersList,
          sourceTypes,
          targetCount,
        });
        setStage("review");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : "Failed to analyze request",
        );
        setStage("input");
      });

    return () => {
      cancelled = true;
    };
  }, [stage, prompt]);

  function analyze() {
    if (!prompt.trim()) return;
    setStage("analyzing");
  }

  async function startCollection() {
    if (!contract || !user) return;
    setSubmitting(true);
    setError(null);

    try {
      const result = await api.post<ExecuteResponse>("/workflows/execute", {
        prompt,
        workspaceId: user.workspaceId,
        createdById: user.id,
      });
      // Navigate to the live workflow page with the run ID
      router.push(`/dashboard/workflows/live?runId=${result.runId}&workflowId=${result.workflowId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start workflow");
      setSubmitting(false);
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

      {error && (
        <div className="mb-4 rounded-lg bg-danger-soft border border-danger/20 p-3 text-[12.5px] text-danger font-medium">
          {error}
        </div>
      )}

      <AnimatePresence mode="wait">
        {stage === "input" && (
          <motion.div key="input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
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
            />
            <Button className="mt-4 bg-primary text-primary-foreground hover:bg-primary-hover font-semibold" onClick={analyze}>
              Analyze request <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </motion.div>
        )}

        {stage === "analyzing" && (
          <motion.div
            key="analyzing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center rounded-xl border border-border bg-card py-16 text-center shadow-subtle"
          >
            <div className="relative flex h-14 w-14 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-tan/20" />
              <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-surface border border-border text-tan">
                <CompassIcon className="h-6 w-6 animate-spin" style={{ animationDuration: "6s" }} />
              </span>
            </div>
            <p className="mt-4 font-serif text-lg font-bold text-foreground">Planning research trajectory</p>
            <p className="mt-1 max-w-sm text-[13px] text-muted-foreground leading-relaxed">
              Identifying target entities, data contracts, verification filters and source ports.
            </p>
          </motion.div>
        )}

        {stage === "review" && contract && (
          <motion.div key="review" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="mb-5 flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-xs">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-tan">
                  <SpyglassIcon className="h-3.5 w-3.5" />
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Your request</p>
                </div>
                <p className="mt-1 text-[13.5px] font-medium leading-snug text-foreground">{prompt}</p>
              </div>
              <button
                type="button"
                onClick={() => setStage("input")}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>

            <PlanPreview contract={contract} onChange={setContract} />

            <div className="mt-5 flex justify-end gap-2.5">
              <Button variant="secondary" onClick={() => setStage("input")}>
                Edit prompt
              </Button>
              <Button
                onClick={startCollection}
                loading={submitting}
                className="bg-primary text-primary-foreground hover:bg-primary-hover font-semibold"
              >
                {submitting ? "Creating…" : (
                  <>
                    Create workflow <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
