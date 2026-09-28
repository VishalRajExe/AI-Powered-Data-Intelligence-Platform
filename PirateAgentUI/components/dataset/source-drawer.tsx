"use client";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ExternalLink } from "lucide-react";
import { AnchorCheckIcon, CrossedAnchorIcon, LighthouseIcon } from "@/components/icons";
import { formatDate } from "@/lib/utils";
import type { DatasetRow, SourceRecord, DataField } from "@/lib/types";

export function SourceDrawer({
  row,
  sources = [],
  fields = [],
  open,
  onOpenChange,
}: {
  row: DatasetRow | null;
  sources?: SourceRecord[];
  fields?: DataField[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const safeFields = fields ?? [];
  const safeSources = sources ?? [];
  const rowData = ((row?.data ?? (row as any)?.values ?? {}) as Record<string, unknown>);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {row && (
        <SheetContent className="bg-card border-border shadow-xl">
          <div className="p-6">
            <SheetTitle className="font-serif text-2xl font-bold tracking-tight text-foreground">
              Record detail
            </SheetTitle>
            <p className="mt-1 text-[12.5px] text-muted-foreground">Collected {formatDate(row.collectedAt)}</p>

            <div className="mt-5 flex items-center gap-2">
              {row.isValid ? (
                <Badge variant="success">
                  <AnchorCheckIcon className="h-3 w-3" /> Valid
                </Badge>
              ) : (
                <Badge variant="danger">
                  <CrossedAnchorIcon className="h-3 w-3" /> Needs review
                </Badge>
              )}
              <Badge variant="default">{typeof row.confidence === "number" ? (row.confidence <= 1 ? Math.round(row.confidence * 100) : Math.round(row.confidence)) : 90}% confidence</Badge>
            </div>

            <Separator className="my-5 bg-border/60" />

            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Structured data</p>
            <dl className="space-y-2.5">
              {safeFields.map((f) => {
                const rawVal = rowData[f.name] ?? (f.label ? rowData[f.label] : undefined) ?? "—";
                const val = typeof rawVal === "object" && rawVal !== null ? JSON.stringify(rawVal) : String(rawVal);
                return (
                  <div key={f.name} className="flex items-start justify-between gap-4 text-[13px]">
                    <dt className="capitalize text-muted-foreground">{f.label || f.name}</dt>
                    <dd className="text-right font-medium text-foreground">{val}</dd>
                  </div>
                );
              })}
            </dl>

            <Separator className="my-5 bg-border/60" />

            <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <LighthouseIcon className="h-3.5 w-3.5 text-tan" />
              <span>Evidence ({safeSources.length} source{safeSources.length !== 1 ? "s" : ""})</span>
            </div>
            <div className="space-y-2.5">
              {safeSources.map((s) => (
                <a
                  key={s.id}
                  href={`https://${s.domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg border border-border bg-surface/60 p-3 transition-colors hover:border-tan/60 hover:bg-surface"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[13px] font-semibold text-foreground">{s.title}</p>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{s.domain}</p>
                  <p className="mt-1.5 text-[12.5px] text-foreground/80">{s.snippet}</p>
                </a>
              ))}
            </div>
          </div>
        </SheetContent>
      )}
    </Sheet>
  );
}
