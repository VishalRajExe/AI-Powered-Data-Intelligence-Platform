import React from "react";
import { cn } from "@/lib/utils";

export function StatCard({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  tone?: "default" | "primary" | "success" | "warning" | "info";
}) {
  const toneMap = {
    default: "bg-surface text-muted-foreground border border-border/60",
    primary: "bg-surface text-tan border border-border/80",
    success: "bg-success-soft text-success border border-success/30",
    warning: "bg-warning-soft text-warning border border-warning/30",
    info: "bg-info-soft text-info border border-info/30",
  } as const;

  return (
    <div className="flex items-center gap-3.5 rounded-lg border border-border bg-card p-4 shadow-subtle hover:border-tan/40 transition-colors">
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-md", toneMap[tone])}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="font-serif text-2xl font-bold leading-tight text-foreground">{value}</p>
        <p className="truncate text-[12px] font-medium text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
