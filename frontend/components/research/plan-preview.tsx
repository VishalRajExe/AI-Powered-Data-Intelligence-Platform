"use client";
import {
  CompassIcon,
  ShipLogIcon,
  SpyglassIcon,
  LighthouseIcon,
  TreasureMapIcon,
} from "@/components/icons";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PlanView } from "@/lib/api/types";
import { numberOrUndefined, readPlan, parseJsonObject } from "@/lib/plan";

/**
 * The plan the AI service proposed and Spring validated, shown as it is stored.
 *
 * The previous screen let a reader add or delete a field chip here, which changed nothing: the
 * fields a run collects come from the stored plan document, and the only way to change them is to
 * change the prompt and re-plan. So this screen is read-only, and says where its content came from.
 */
export function PlanPreview({ plan }: { plan: PlanView }) {
  const { steps, fields, requiredFields, seedQueries, limits, deduplicationKeys } = readPlan(plan);
  const policy = parseJsonObject(plan.sourcePolicy);
  const criteria = parseJsonObject(plan.completionCriteria);
  const targetCount = numberOrUndefined(limits.expectedRecords);
  const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card shadow-subtle">
        <CardContent className="p-5">
          <SectionLabel icon={CompassIcon} text="Detected objective" />
          <p className="mt-2 text-[14.5px] font-medium text-foreground">
            {plan.objective || "The plan states no objective."}
            {targetCount !== undefined && (
              <>
                {" "}
                — target of <span className="font-semibold text-primary">{targetCount}</span> records
              </>
            )}
            {typeof limits.entityType === "string" && (
              <>
                {" "}
                of entity type{" "}
                <span className="font-semibold text-primary">{limits.entityType}</span>
              </>
            )}
          </p>
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            plan v{plan.version} · {plan.planHash}
          </p>
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-subtle">
        <CardContent className="p-5">
          <SectionLabel icon={ShipLogIcon} text="Fields to collect" />
          {fields.length === 0 ? (
            <p className="mt-3 text-[13px] text-muted-foreground">
              This plan has no transform step, so it declares no field list.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {fields.map((f) => (
                <span
                  key={f.key}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-[12.5px] font-medium text-foreground"
                  title={f.type ? `${f.key} · ${f.type}` : f.key}
                >
                  {f.label || f.key}
                  {f.required && <span className="text-tan">*</span>}
                </span>
              ))}
            </div>
          )}
          <p className="mt-3 text-[11.5px] text-muted-foreground">
            {requiredFields.length} required of {fields.length} declared. Add or drop a field by
            editing the prompt and re-planning; a plan version is immutable once stored.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-subtle">
        <CardContent className="p-5">
          <SectionLabel icon={SpyglassIcon} text="Queries and keys" />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {seedQueries.length === 0 && (
              <p className="text-[13px] text-muted-foreground">The plan declares no seed queries.</p>
            )}
            {seedQueries.map((q) => (
              <span
                key={q}
                className="rounded-full bg-surface border border-border px-3 py-1 text-[12.5px] font-medium text-foreground"
              >
                {q}
              </span>
            ))}
          </div>
          {deduplicationKeys.length > 0 && (
            <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
              Duplicates are matched on{" "}
              {deduplicationKeys.map((key, i) => (
                <span key={key}>
                  <span className="font-mono text-[11.5px] text-foreground">{key}</span>
                  {i < deduplicationKeys.length - 1 ? ", " : "."}
                </span>
              ))}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-subtle">
        <CardContent className="p-5">
          <SectionLabel icon={LighthouseIcon} text="Source policy" />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {policy.allowedDomains !== undefined && <PolicyBadge prefix="allowed" value={policy.allowedDomains} />}
            {policy.blockedDomains !== undefined && <PolicyBadge prefix="blocked" value={policy.blockedDomains} />}
            {policy.preferredDomains !== undefined && (
              <PolicyBadge prefix="preferred" value={policy.preferredDomains} />
            )}
            {typeof policy.respectRobotsTxt === "boolean" && (
              <Badge variant={policy.respectRobotsTxt ? "success" : "danger"}>
                respect robots.txt: {String(policy.respectRobotsTxt)}
              </Badge>
            )}
            {typeof policy.allowAuthentication === "boolean" && (
              <Badge variant={policy.allowAuthentication ? "danger" : "success"}>
                authentication: {String(policy.allowAuthentication)}
              </Badge>
            )}
            {typeof policy.allowCaptchaBypass === "boolean" && (
              <Badge variant={policy.allowCaptchaBypass ? "danger" : "success"}>
                captcha bypass: {String(policy.allowCaptchaBypass)}
              </Badge>
            )}
          </div>
          {list(policy.unenforceablePreferences).length > 0 && (
            <p className="mt-3 text-[12px] leading-relaxed text-warning">
              Preferences the policy cannot enforce, kept visible rather than silently dropped:{" "}
              {list(policy.unenforceablePreferences).join(", ")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-subtle">
        <CardContent className="p-5">
          <SectionLabel icon={TreasureMapIcon} text="Workflow steps" />
          <ol className="mt-3 space-y-2">
            {steps.map((s, i) => (
              <li key={s.key} className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-[11px] font-semibold text-foreground">
                  {i + 1}
                </span>
                <span className="font-medium text-foreground/80">{s.key}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{s.type}</span>
                {s.dependsOn?.length > 0 && (
                  <span className="text-[11px] text-muted-foreground/80">after {s.dependsOn.join(", ")}</span>
                )}
              </li>
            ))}
          </ol>
          {Object.keys(criteria).length > 0 && (
            <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
              Completes at{" "}
              {typeof criteria.minimumRecords === "number" ? `${criteria.minimumRecords} records` : "no stated minimum"}
              {criteria.requireSourceEvidence === true && ", with source evidence for each record"}
              {typeof criteria.enforcedBy === "string" ? `, enforced by ${criteria.enforcedBy}` : ""}.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SectionLabel({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="flex items-center gap-2 text-tan">
      <Icon className="h-4 w-4" />
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{text}</span>
    </div>
  );
}

function PolicyBadge({ prefix, value }: { prefix: string; value: unknown }) {
  const entries = Array.isArray(value) ? value.map(String) : [];
  if (entries.length === 0) return null;
  return (
    <Badge variant="default">
      {prefix}: {entries.join(", ")}
    </Badge>
  );
}
