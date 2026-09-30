"use client";

import { useCallback, useState } from "react";
import { LighthouseIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { ReadError } from "@/components/common/read-error";
import { Pagination } from "@/components/common/pagination";
import { datasets } from "@/lib/api/endpoints";
import { useLive } from "@/hooks/use-live";
import { formatNumber, formatRelativeTime, plural } from "@/lib/utils";

const PAGE_SIZE = 25;

/**
 * The sources behind one dataset, and how each was obtained.
 *
 * `verifiedByTool` is the distinction that matters: a source a tool actually fetched is not the same
 * claim as a URL the model cited without retrieving it, and the counts summary above the list states
 * both separately rather than merging them into one "sources" figure.
 */
export function SourcesPanel({ datasetId }: { datasetId: string }) {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [verified, setVerified] = useState<"" | "true" | "false">("");

  const load = useCallback(
    (signal?: AbortSignal) =>
      datasets.sources(
        datasetId,
        {
          pageSize: PAGE_SIZE,
          page,
          ...(term ? { q: term } : {}),
          ...(verified === "" ? {} : { verified: verified === "true" }),
        },
        signal
      ),
    [datasetId, page, term, verified]
  );
  const { data, error, loading, settled, reload } = useLive(load);

  const rows = data?.sources ?? [];
  const counts = data?.counts;

  return (
    <div className="space-y-4">
      {counts && (
        <Card className="border-border bg-card shadow-subtle">
          <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-2 py-4">
            <Figure label="All sources" value={counts.all} />
            <Figure label="Verified by a tool" value={counts.verifiedByTool} tone="success" />
            <Figure label="Cited by the model only" value={counts.modelCitedOnly} tone="warning" />
            <Figure label="Blocked before fetch" value={counts.blockedBeforeFetch} tone="danger" />
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setPage(0);
              setTerm(search.trim());
            }
          }}
          placeholder="filter by URL, title or domain"
          className="h-8 max-w-xs bg-surface/50 border-border text-foreground text-[12.5px]"
        />
        <select
          value={verified}
          onChange={(event) => {
            setVerified(event.target.value as typeof verified);
            setPage(0);
          }}
          className="h-8 rounded-md border border-border bg-surface px-2 text-[12.5px] text-foreground"
          aria-label="Filter by tool verification"
        >
          <option value="">Any provenance</option>
          <option value="true">Verified by tool</option>
          <option value="false">Not verified</option>
        </select>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setPage(0);
            setTerm(search.trim());
          }}
        >
          Apply
        </Button>
        <Button variant="ghost" size="sm" onClick={reload} disabled={loading}>
          {settled && !loading ? "Refresh" : "Loading…"}
        </Button>
      </div>

      {error && <ReadError error={error} label="Sources unavailable" onRetry={reload} />}

      {loading && !settled ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 && !error ? (
        <EmptyState
          icon={LighthouseIcon}
          title="No sources match"
          description="This dataset has no source rows for the filter applied. A dataset saved without sources would be a contract violation, so that combination is worth checking."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((source) => (
            <div key={source.id} className="rounded-lg border border-border/60 bg-card px-3 py-2.5 shadow-subtle">
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-primary underline underline-offset-2 hover:text-foreground"
                >
                  {source.title || source.url}
                </a>
                <Badge variant={source.verifiedByTool ? "success" : "warning"}>
                  {source.verifiedByTool ? "tool-verified" : source.provenance || "cited only"}
                </Badge>
                {source.blockedCode && <Badge variant="danger">{source.blockedCode}</Badge>}
              </div>
              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{source.url}</p>
              {source.snippet && (
                <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                  {source.snippet}
                </p>
              )}
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                {source.domain && `${source.domain} · `}
                {typeof source.citationCount === "number"
                  ? `${plural(source.citationCount, "citation")} · `
                  : ""}
                {typeof source.citedByRows === "number"
                  ? `${plural(source.citedByRows, "row", "rows")} · `
                  : ""}
                {source.retrievedAt ? `retrieved ${formatRelativeTime(source.retrievedAt)}` : "never retrieved"}
              </p>
              {source.blockedReason && (
                <p className="mt-1 text-[11.5px] font-medium text-danger">{source.blockedReason}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <Pagination
        currentPage={page + 1}
        totalPages={Math.max(Math.ceil((data?.total ?? 0) / PAGE_SIZE), 1)}
        totalItems={data?.total ?? 0}
        pageSize={PAGE_SIZE}
        itemLabel="sources"
        onPageChange={(next) => setPage(next - 1)}
      />
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: "success" | "warning" | "danger" }) {
  const colour =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "danger" ? "text-danger" : "text-foreground";
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`font-serif text-[19px] font-bold leading-none ${colour}`}>{formatNumber(value)}</span>
      <span className="text-[11.5px] font-medium text-muted-foreground">{label}</span>
    </div>
  );
}
