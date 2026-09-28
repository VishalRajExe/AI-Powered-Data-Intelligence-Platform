"use client";
import { ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { LighthouseIcon } from "@/components/icons";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DataField, DatasetRow } from "@/lib/types";

export interface SortState {
  key: string | null;
  dir: "asc" | "desc";
}

export function DataTable({
  fields,
  rows,
  page,
  pageSize,
  total,
  selected,
  sort,
  onSort,
  onToggleRow,
  onToggleAll,
  onOpenRow,
  onPageChange,
}: {
  fields: DataField[];
  rows: DatasetRow[];
  page: number;
  pageSize: number;
  total: number;
  selected: Set<string>;
  sort: SortState;
  onSort: (key: string) => void;
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  onOpenRow: (row: DatasetRow) => void;
  onPageChange: (page: number) => void;
}) {
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-subtle">
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-surface/90 border-b border-border">
            <tr>
              <th className="w-10 px-3.5 py-3">
                <Checkbox checked={allChecked} onCheckedChange={onToggleAll} />
              </th>
              {fields.map((f) => (
                <th key={f.name} className="whitespace-nowrap px-3.5 py-3">
                  <button
                    onClick={() => onSort(f.name)}
                    className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {f.name}
                    <ArrowUpDown className={cn("h-3 w-3", sort.key === f.name ? "text-primary" : "text-muted-foreground/50")} />
                  </button>
                </th>
              ))}
              <th className="px-3.5 py-3 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">Confidence</th>
              <th className="px-3.5 py-3 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">Sources</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer transition-colors hover:bg-surface/60"
                onClick={() => onOpenRow(row)}
              >
                <td className="px-3.5 py-3" onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={selected.has(row.id)} onCheckedChange={() => onToggleRow(row.id)} />
                </td>
                {fields.map((f) => (
                  <td key={f.name} className="max-w-[220px] truncate px-3.5 py-3 text-foreground font-normal">
                    {f.type === "url" ? (
                      <span className="text-primary hover:underline font-medium">{String(row.data[f.name] ?? "—")}</span>
                    ) : (
                      String(row.data[f.name] ?? "—")
                    )}
                  </td>
                ))}
                <td className="px-3.5 py-3">
                  <Badge variant={row.confidence >= 85 ? "success" : row.confidence >= 70 ? "warning" : "danger"}>
                    {row.confidence}%
                  </Badge>
                </td>
                <td className="px-3.5 py-3">
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
                    <LighthouseIcon className="h-3.5 w-3.5 text-tan" /> {row.sourceIds.length}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-border bg-surface/40 px-3.5 py-2.5">
        <p className="text-[12px] font-medium text-muted-foreground">
          Page {page} of {totalPages} · {total} records
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 bg-card border-border/80"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 bg-card border-border/80"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
