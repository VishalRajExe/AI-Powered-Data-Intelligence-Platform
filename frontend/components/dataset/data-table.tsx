"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { originTitle } from "@/lib/origins";
import type { DataRow, DatasetColumn } from "@/lib/api/types";

/**
 * The rows of a dataset, in the order its own columns were derived.
 *
 * A cell shows what is stored, or the honest statement that the field is absent from this record.
 * Empty is never rendered as a guess, and a value that came from `raw_values` rather than the
 * normalised column is not silently substituted for one that did.
 */
export function DataTable({
  columns,
  rows,
  sortKey,
  ascending,
  onSort,
  onInspect,
}: {
  columns: DatasetColumn[];
  rows: DataRow[];
  sortKey?: string;
  ascending?: boolean;
  onSort?: (key: string) => void;
  onInspect?: (row: DataRow) => void;
}) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-b border-border">
            <th className="w-10 px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              #
            </th>
            {columns.map((column) => (
              <th key={column.key} className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <button
                  type="button"
                  disabled={!onSort}
                  onClick={() => onSort?.(column.key)}
                  className={cn(
                    "inline-flex items-center gap-1",
                    onSort && "hover:text-foreground transition-colors"
                  )}
                  title={originTitle(column.origin)}
                >
                  {column.label || column.key}
                  {sortKey === column.key &&
                    (ascending === false ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                </button>
              </th>
            ))}
            <th className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Evidence
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => onInspect?.(row)}
              className={cn(
                "border-b border-border/40 last:border-b-0",
                onInspect && "cursor-pointer hover:bg-surface",
                row.duplicateOf && "opacity-60"
              )}
            >
              <td className="px-2 py-2 font-mono text-[11px] text-muted-foreground">
                {row.recordIndex}
              </td>
              {columns.map((column) => (
                <Cell key={column.key} value={row.values[column.key]} />
              ))}
              <td className="px-2 py-2">
                <div className="flex items-center gap-1.5">
                  <Badge variant={row.valid ? "success" : "danger"}>{row.valid ? "valid" : "invalid"}</Badge>
                  {row.duplicateOf && <Badge variant="warning">duplicate</Badge>}
                  {row.reviewRequired && <Badge variant="warning">review</Badge>}
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {row.evidencedFieldCount ?? 0}/{row.populatedFieldCount ?? 0}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ value }: { value: unknown }) {
  if (value === undefined) {
    return (
      <td className="px-2 py-2 text-[12.5px] italic text-muted-foreground/60" title="field absent from this record">
        —
      </td>
    );
  }
  if (value === null) {
    return (
      <td className="px-2 py-2 text-[12.5px] italic text-muted-foreground/60" title="stored as null">
        null
      </td>
    );
  }
  if (typeof value === "object") {
    return (
      <td className="max-w-[280px] px-2 py-2 font-mono text-[11.5px] text-foreground">
        <span className="line-clamp-3">{JSON.stringify(value)}</span>
      </td>
    );
  }
  const text = String(value);
  const isHttp = /^https?:\/\/\S+$/i.test(text);
  return (
    <td className="max-w-[280px] px-2 py-2 text-[12.5px] text-foreground">
      {isHttp ? (
        <a
          href={text}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={(event) => event.stopPropagation()}
          className="break-all text-primary underline underline-offset-2 hover:text-foreground"
        >
          {text}
        </a>
      ) : (
        <span className="line-clamp-3 break-words">{text}</span>
      )}
    </td>
  );
}
