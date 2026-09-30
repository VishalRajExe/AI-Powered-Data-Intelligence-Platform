"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ShipLogIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReadError } from "@/components/common/read-error";
import { Pagination } from "@/components/common/pagination";
import { DataTable } from "@/components/dataset/data-table";
import { SourcesPanel } from "@/components/dataset/sources-panel";
import { ExportPanel } from "@/components/dataset/export-panel";
import { datasets } from "@/lib/api/endpoints";
import { isDeclared } from "@/lib/origins";
import { useLive } from "@/hooks/use-live";
import { formatNumber, plural } from "@/lib/utils";
import type { DataRow } from "@/lib/api/types";

const PAGE_SIZE = 25;

/** One dataset: its rows, the columns that hold them, the sources behind them, and its exports. */
export default function DatasetDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const datasetId = params.id;

  const details = useLive(
    useCallback((signal?: AbortSignal) => datasets.details(datasetId, signal), [datasetId])
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <button
        onClick={() => router.push("/dashboard/datasets")}
        className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to datasets
      </button>

      <header className="space-y-1">
        <h1 className="flex items-center gap-2 font-serif text-2xl font-bold tracking-tight text-foreground md:text-[28px]">
          <ShipLogIcon className="h-6 w-6 text-primary" />
          {details.data?.entityType || "Dataset"}
        </h1>
        {details.data?.objective && (
          <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            {details.data.objective}
          </p>
        )}
        <p className="font-mono text-[11.5px] text-muted-foreground">{datasetId}</p>
        {details.data && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge
              variant={
                details.data.status === "COMPLETED"
                  ? "success"
                  : details.data.status === "FAILED"
                    ? "danger"
                    : "default"
              }
            >
              {details.data.status}
            </Badge>
            <Badge variant="outline">{plural(details.data.rowCount, "row")}</Badge>
            <Badge variant="outline">{plural(details.data.validRowCount ?? 0, "valid")}</Badge>
            <Badge variant="outline">{plural(details.data.duplicateCount ?? 0, "duplicate")}</Badge>
            <Badge variant="outline">{plural(details.data.conflictCount ?? 0, "conflict")}</Badge>
            <Badge variant="outline">{plural(details.data.sourceCount, "source")}</Badge>
            {typeof details.data.qualityScore === "number" && (
              <Badge variant={details.data.qualityScore >= 0.8 ? "success" : "warning"}>
                quality {Math.round(details.data.qualityScore * 100)}%
              </Badge>
            )}
          </div>
        )}
        {details.data?.qualityBasis && (
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Quality basis:</span>{" "}
            {details.data.qualityBasis}
          </p>
        )}
      </header>

      {details.error && <ReadError error={details.error} label="Dataset unavailable" onRetry={details.reload} />}

      <Tabs defaultValue="rows">
        <TabsList className="flex-wrap">
          <TabsTrigger value="rows">Rows</TabsTrigger>
          <TabsTrigger value="columns">Columns</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="exports">Exports</TabsTrigger>
        </TabsList>

        <TabsContent value="rows">
          <RowsTab datasetId={datasetId} />
        </TabsContent>
        <TabsContent value="columns">
          <ColumnsTab datasetId={datasetId} />
        </TabsContent>
        <TabsContent value="sources">
          <SourcesPanel datasetId={datasetId} />
        </TabsContent>
        <TabsContent value="evidence">
          <EvidenceTab datasetId={datasetId} />
        </TabsContent>
        <TabsContent value="exports">
          <ExportPanel datasetId={datasetId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RowsTab({ datasetId }: { datasetId: string }) {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [sortKey, setSortKey] = useState<string | undefined>();
  const [ascending, setAscending] = useState(true);
  const [validOnly, setValidOnly] = useState(false);
  const [includeDuplicates, setIncludeDuplicates] = useState(true);
  const [selected, setSelected] = useState<DataRow | null>(null);

  const schema = useLive(
    useCallback((signal?: AbortSignal) => datasets.schema(datasetId, signal), [datasetId])
  );
  const load = useCallback(
    (signal?: AbortSignal) =>
      datasets.rows(
        datasetId,
        {
          pageSize: PAGE_SIZE,
          page,
          ...(term ? { q: term } : {}),
          ...(sortKey ? { sort: sortKey, asc: ascending } : {}),
          ...(validOnly ? { validOnly: true } : {}),
          includeDuplicates,
        },
        signal
      ),
    [datasetId, page, term, sortKey, ascending, validOnly, includeDuplicates]
  );
  const { data, error, loading, settled, reload } = useLive(load);

  const evidence = useLive(
    useCallback(
      (signal?: AbortSignal) =>
        selected ? datasets.rowEvidence(datasetId, selected.id, signal) : Promise.resolve(null),
      [datasetId, selected]
    )
  );

  const columns = schema.data?.columns ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setPage(0);
              setTerm(search.trim());
            }
          }}
          placeholder="search values in this dataset"
          className="h-8 max-w-xs bg-surface/50 border-border text-foreground text-[12.5px]"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setPage(0);
            setTerm(search.trim());
          }}
        >
          Search
        </Button>
        <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Checkbox checked={validOnly} onCheckedChange={(value) => setValidOnly(value === true)} />
          valid rows only
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Checkbox
            checked={includeDuplicates}
            onCheckedChange={(value) => setIncludeDuplicates(value === true)}
          />
          show duplicates
        </label>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={reload} disabled={loading}>
          {settled && !loading ? "Refresh" : "Loading…"}
        </Button>
      </div>

      {schema.error && <ReadError error={schema.error} label="Column list unavailable" onRetry={schema.reload} />}
      {error && <ReadError error={error} label="Rows unavailable" onRetry={reload} />}

      <Card className="border-border bg-card shadow-subtle">
        <CardContent className="pt-5">
          {loading && !settled ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 rounded-md" />
              ))}
            </div>
          ) : columns.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              This dataset declares no columns, so there is no order to render its rows in.
            </p>
          ) : (data?.rows ?? []).length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              No rows match the search and filters applied.
            </p>
          ) : (
            <DataTable
              columns={columns}
              rows={data?.rows ?? []}
              sortKey={sortKey}
              ascending={ascending}
              onSort={(key) => {
                setPage(0);
                if (sortKey === key) setAscending(!ascending);
                else {
                  setSortKey(key);
                  setAscending(true);
                }
              }}
              onInspect={(row) => setSelected(row)}
            />
          )}

          <Pagination
            currentPage={page + 1}
            totalPages={Math.max(Math.ceil((data?.matchedRows ?? 0) / PAGE_SIZE), 1)}
            totalItems={data?.matchedRows ?? 0}
            pageSize={PAGE_SIZE}
            itemLabel="rows"
            onPageChange={(next) => setPage(next - 1)}
          />
        </CardContent>
      </Card>

      {selected && (
        <Card className="border-border bg-card shadow-subtle">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="font-serif text-lg font-bold tracking-tight">
                Row {selected.recordIndex} — where each value came from
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {evidence.error && (
              <ReadError error={evidence.error} label="Evidence unavailable" onRetry={evidence.reload} />
            )}
            {evidence.loading && !evidence.settled && <Skeleton className="h-32 w-full rounded-lg" />}
            {evidence.data && (
              <>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  run <span className="font-mono text-[11.5px] text-foreground">{evidence.data.runId}</span> ·
                  step <span className="font-mono text-[11.5px] text-foreground">{evidence.data.stepId}</span> ·{" "}
                  {formatNumber(evidence.data.evidencedFieldCount ?? 0)} of{" "}
                  {formatNumber(evidence.data.populatedFieldCount ?? 0)} fields attributed to a source
                </p>
                <ul className="space-y-1.5">
                  {evidence.data.fields.map((field) => (
                    <li key={field.key} className="rounded-md border border-border/60 bg-surface/40 px-3 py-2">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-mono text-[11.5px] font-semibold text-foreground">{field.key}</span>
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
                          {String(field.value ?? "")}
                        </span>
                        <Badge variant={field.attributed ? "success" : "warning"}>
                          {field.attributed
                            ? `${plural(field.attributedSources.length, "source", "sources")} attributed`
                            : "row-level only"}
                        </Badge>
                      </div>
                      {field.attributed && (
                        <p className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground">
                          {field.attributedSources
                            .map((source) => String(source.url ?? source.sourceId ?? ""))
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                      {!field.attributed && field.rowLevelSources.length > 0 && (
                        <p className="mt-1 text-[11px] italic text-muted-foreground/90">
                          This row&apos;s sources back it as a whole; none is attributed to this field.
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
                {evidence.data.conflicts.length > 0 && (
                  <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2">
                    <p className="text-[12px] font-semibold text-warning">
                      {plural(evidence.data.conflicts.length, "conflicting value", "conflicting values")},
                      both kept
                    </p>
                    {evidence.data.conflicts.map((conflict, index) => (
                      <p key={`${conflict.columnKey}-${index}`} className="mt-1 text-[11.5px] text-muted-foreground">
                        <span className="font-mono">{conflict.columnKey}</span>: kept{" "}
                        <span className="font-mono">{String(conflict.keptValue)}</span> over{" "}
                        <span className="font-mono">{String(conflict.rejectedValue)}</span>
                        {conflict.resolvedBy ? ` by ${conflict.resolvedBy}` : ""}
                      </p>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ColumnsTab({ datasetId }: { datasetId: string }) {
  const schema = useLive(
    useCallback((signal?: AbortSignal) => datasets.schema(datasetId, signal), [datasetId])
  );

  if (schema.error) return <ReadError error={schema.error} label="Schema unavailable" onRetry={schema.reload} />;
  if (schema.loading && !schema.settled) return <Skeleton className="h-40 w-full rounded-lg" />;

  return (
    <Card className="border-border bg-card shadow-subtle">
      <CardContent className="pt-5">
        <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">{schema.data?.note}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                {["#", "Key", "Label", "Type", "Required", "Origin", "Populated"].map((heading) => (
                  <th
                    key={heading}
                    className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(schema.data?.columns ?? []).map((column) => (
                <tr key={column.key} className="border-b border-border/40 last:border-b-0">
                  <td className="px-2 py-2 font-mono text-[11px] text-muted-foreground">{column.position}</td>
                  <td className="px-2 py-2 font-mono text-[12px] text-foreground">{column.key}</td>
                  <td className="px-2 py-2 text-[12.5px] text-foreground">{column.label || "—"}</td>
                  <td className="px-2 py-2 font-mono text-[11.5px] text-muted-foreground">{column.type}</td>
                  <td className="px-2 py-2 text-[12.5px] text-muted-foreground">
                    {column.required ? "yes" : "no"}
                  </td>
                  <td className="px-2 py-2">
                    <Badge variant={isDeclared(column.origin) ? "info" : "default"}>{column.origin}</Badge>
                  </td>
                  <td className="px-2 py-2 font-mono text-[12px] text-muted-foreground">
                    {formatNumber(column.populatedCount ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function EvidenceTab({ datasetId }: { datasetId: string }) {
  const evidence = useLive(
    useCallback((signal?: AbortSignal) => datasets.evidence(datasetId, signal), [datasetId])
  );

  if (evidence.error) return <ReadError error={evidence.error} label="Evidence unavailable" onRetry={evidence.reload} />;
  if (evidence.loading && !evidence.settled) return <Skeleton className="h-40 w-full rounded-lg" />;
  const data = evidence.data;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card shadow-subtle">
        <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-2 py-4">
          <span className="font-serif text-[19px] font-bold leading-none text-foreground">
            {plural(data.rowCount, "row", "rows")}
          </span>
          <span
            className={`font-serif text-[19px] font-bold leading-none ${
              (data.recordsWithoutEvidence ?? 0) > 0 ? "text-warning" : "text-success"
            }`}
          >
            {plural(data.recordsWithoutEvidence ?? 0, "row", "rows")}
          </span>
          <span className="text-[11.5px] font-medium text-muted-foreground">
            cite no source at all
          </span>
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-subtle">
        <CardHeader className="pb-3">
          <CardTitle className="font-serif text-lg font-bold tracking-tight">Coverage per column</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b border-border pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Column</span>
            <span>Type</span>
            <span className="text-right">With value</span>
            <span className="text-right">Attributed</span>
          </div>
          {data.coverage.map((column) => (
            <div
              key={column.key}
              className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-x-4 py-1 text-[12.5px]"
            >
              <span className="min-w-0 truncate font-mono text-[11.5px] text-foreground">
                {column.key}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">{column.type}</span>
              <span className="text-right font-mono text-[12px] text-muted-foreground">
                {formatNumber(column.rowsWithValue)}
              </span>
              <span
                className={`text-right font-mono text-[12px] ${
                  column.rowsWithValue > 0 && column.rowsAttributed === 0
                    ? "text-warning"
                    : "text-foreground"
                }`}
              >
                {formatNumber(column.rowsAttributed)}
              </span>
            </div>
          ))}
          {data.coverage.length === 0 && (
            <p className="text-[13px] text-muted-foreground">No columns to measure coverage against.</p>
          )}
          <p className="pt-2 text-[11.5px] leading-relaxed text-muted-foreground">
            <span className="text-warning">Amber</span> means values exist for that column in this
            dataset and not one of them is traceable to a source.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border bg-card shadow-subtle">
          <CardHeader className="pb-3">
            <CardTitle className="font-serif text-lg font-bold tracking-tight">Rows with no evidence</CardTitle>
          </CardHeader>
          <CardContent>
            {data.rowsWithoutEvidence.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Every row cites at least one source.</p>
            ) : (
              <ul className="space-y-1 text-[12.5px] text-muted-foreground">
                {data.rowsWithoutEvidence.map((row) => (
                  <li key={row.id} className="flex items-center gap-2">
                    <span className="font-mono text-[11.5px] text-foreground">#{row.recordIndex}</span>
                    <span className="truncate font-mono text-[11px]">{row.id}</span>
                  </li>
                ))}
              </ul>
            )}
            {data.truncation.rowsWithoutEvidence && (
              <p className="mt-2 text-[11.5px] text-warning">List truncated at 100 rows.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-subtle">
          <CardHeader className="pb-3">
            <CardTitle className="font-serif text-lg font-bold tracking-tight">
              Cited but never retrieved
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.citedButNeverRetrieved.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Every cited URL was fetched by a tool during this run.
              </p>
            ) : (
              <ul className="space-y-1 text-[12.5px] text-muted-foreground">
                {data.citedButNeverRetrieved.map((source) => (
                  <li key={source.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{source.url}</span>
                    <span className="shrink-0 font-mono text-[11px]">{source.citedByRows ?? 0} rows</span>
                  </li>
                ))}
              </ul>
            )}
            {data.truncation.citedButNeverRetrieved && (
              <p className="mt-2 text-[11.5px] text-warning">List truncated at 100 sources.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
