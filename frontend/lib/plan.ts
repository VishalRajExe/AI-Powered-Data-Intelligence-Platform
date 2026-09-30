import type { PlanStep, PlanView } from "@/lib/api/types";

/**
 * Reading the stored plan document.
 *
 * `POST /api/v1/workflows/{id}/plan` returns the plan's own columns, and `steps`, `sourcePolicy`
 * and `completionCriteria` are the JSON text exactly as the planner serialised it — they are the
 * rows a re-read must return byte-for-byte, so they stay strings on the wire and are parsed here.
 */
export function parseJsonArray(text: string): unknown[] {
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [];
}

export function parseJsonObject(text?: string): Record<string, unknown> {
  if (!text) return {};
  const parsed = JSON.parse(text);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

export interface PlanSteps {
  steps: PlanStep[];
  /** The transform step's field list — the plan's own statement of what each record must carry. */
  fields: PlanField[];
  requiredFields: string[];
  seedQueries: string[];
  limits: Record<string, unknown>;
  deduplicationKeys: string[];
}

export interface PlanField {
  key: string;
  label?: string;
  type?: string;
  required?: boolean;
}

/**
 * The facts a screen shows, all of them lifted out of the plan's own step payloads.
 *
 * Nothing here falls back to a default field list: a plan whose steps do not carry a transform
 * stage has no field list, and the screen says so rather than inventing one.
 */
export function readPlan(plan: PlanView): PlanSteps {
  const steps = parseJsonArray(plan.steps) as PlanStep[];
  const byKey = new Map(steps.map((step) => [step.key, step.config ?? {}]));
  const collect = byKey.get("collect") ?? {};
  const transform = byKey.get("transform") ?? {};

  return {
    steps,
    fields: asArray<PlanField>(transform.fields),
    requiredFields: asArray<string>(transform.requiredFields),
    seedQueries: asArray<string>(collect.seedQueries),
    limits: (collect.limits as Record<string, unknown>) ?? {},
    deduplicationKeys: asArray<string>(transform.deduplicationKeys),
  };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** A value from the plan's limits, rendered only when the plan actually states one. */
export function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
