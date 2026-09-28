"use client";
import { useEffect, useState } from "react";
import { notFound, useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { SpyglassIcon, CargoIcon, LighthouseIcon, ShipLogIcon } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ExportMenu } from "@/components/dataset/export-menu";
import { DataTable, type SortState } from "@/components/dataset/data-table";
import { SourceDrawer } from "@/components/dataset/source-drawer";
import { EmptyState } from "@/components/common/empty-state";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/utils";
import type { DataField, DatasetRow, SourceRecord } from "@/lib/types";

const PAGE_SIZE = 20;

interface DatasetDetail {
  id: string;
  name: string;
  description: string;
  recordCount: number;
  sourceCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  fields: DataField[];
}

interface RowsResponse {
  data: DatasetRow[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

interface EvidenceResponse {
  row: DatasetRow;
  sources: SourceRecord[];
}

export default function DatasetDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { user } = useAuth();

  const [dataset, setDataset] = useState<DatasetDetail | null>(null);
  const [rows, setRows] = useState<DatasetRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rowsLoading, setRowsLoading] = useState(false);

  const [query, setQuery] = useState("");
  const [confidenceFilter, setConfidenceFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState>({ key: null, dir: "asc" });
  const [page, setPage] = useState(1);
  const [activeRow, setActiveRow] = useState<DatasetRow | null>(null);
  const [activeSources, setActiveSources] = useState<SourceRecord[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Fetch dataset metadata
  useEffect(() => {
    if (!user) return;
    api
      .get<DatasetDetail>(`/datasets/${params.id}`, {
        workspaceId: user.workspaceId,
        userId: user.id,
      })
      .then(setDataset)
      .catch(() => setDataset(null))
      .finally(() => setLoading(false));
  }, [params.id, user]);

  // Fetch rows whenever filters/page change
  useEffect(() => {
    if (!user || !dataset) return;
    setRowsLoading(true);

    const queryParams: Record<string, string | number | boolean | undefined> = {
      workspaceId: user.workspaceId,
      userId: user.id,
      page,
      limit: PAGE_SIZE,
      search: query || undefined,
      sort: sort.key ? "confidence" : "createdAt",
      order: sort.dir,
    };

    if (confidenceFilter === "high") queryParams.confidenceMin = 0.85;
    if (confidenceFilter === "medium") { queryParams.confidenceMin = 0.70; queryParams.confidenceMax = 0.84; }
    if (confidenceFilter === "low") queryParams.confidenceMax = 0.69;

    api
      .get<RowsResponse>(`/datasets/${params.id}/rows`, queryParams)
      .then((res) => {
        setRows(res.data ?? []);
        setTotalRows(res.pagination?.total ?? 0);
      })
      .catch(() => {
        setRows([]);
        setTotalRows(0);
      })
      .finally(() => setRowsLoading(false));
  }, [params.id, user, dataset, page, query, confidenceFilter, sort]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!dataset) return notFound();

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      const allSelected = rows.every((r) => prev.has(r.id));
      const next = new Set(prev);
      rows.forEach((r) => (allSelected ? next.delete(r.id) : next.add(r.id)));
      return next;
    });
  }
  function handleSort(key: string) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  async function openRow(row: DatasetRow) {
    setActiveRow(row);
    setDrawerOpen(true);

    // Fetch evidence/sources for this row
    if (user) {
      try {
        const evidence = await api.get<EvidenceResponse>(
          `/datasets/${params.id}/rows/${row.id}/evidence`,
          { workspaceId: user.workspaceId, userId: user.id },
        );
        setActiveSources(evidence.sources ?? []);
      } catch {
        setActiveSources([]);
      }
    }
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => router.push("/dashboard/datasets")}
        className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All datasets
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground md:text-3xl">
              {dataset.name}
            </h1>
            <Badge variant={dataset.status === "ready" || dataset.status === "READY" ? "success" : "warning"}>
              {dataset.status === "ready" || dataset.status === "READY" ? "Ready" : "Partial"}
            </Badge>
          </div>
          <p className="mt-1 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground">
            {dataset.description}
          </p>
        </div>
        <ExportMenu datasetId={dataset.id} name={dataset.name} count={selected.size} />
      </div>

      <div className="grid grid-cols-3 gap-3.5">
        <Card className="border-border bg-card shadow-subtle">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-surface border border-border flex items-center justify-center text-tan">
              <CargoIcon className="h-4 w-4" />
            </div>
            <div>
              <p className="font-serif text-xl font-bold leading-none text-foreground">{formatNumber(dataset.recordCount)}</p>
              <p className="mt-1 text-[11.5px] font-medium text-muted-foreground">Verified Records</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card shadow-subtle">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-surface border border-border flex items-center justify-center text-tan">
              <LighthouseIcon className="h-4 w-4" />
            </div>
            <div>
              <p className="font-serif text-xl font-bold leading-none text-foreground">{dataset.sourceCount}</p>
              <p className="mt-1 text-[11.5px] font-medium text-muted-foreground">Sources Used</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card shadow-subtle">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-surface border border-border flex items-center justify-center text-tan">
              <ShipLogIcon className="h-4 w-4" />
            </div>
            <div>
              <p className="font-serif text-base font-bold leading-none text-foreground">{formatDate(dataset.updatedAt)}</p>
              <p className="mt-1 text-[11.5px] font-medium text-muted-foreground">Last Updated</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative w-full max-w-[260px]">
          <SpyglassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search records…"
            className="h-8 pl-8 text-[13px] bg-card border-border/80"
          />
        </div>
        <select
          value={confidenceFilter}
          onChange={(e) => {
            setConfidenceFilter(e.target.value as typeof confidenceFilter);
            setPage(1);
          }}
          className="h-8 rounded-md border border-border bg-card px-2.5 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary font-medium"
        >
          <option value="all">All confidence</option>
          <option value="high">High (85%+)</option>
          <option value="medium">Medium (70–84%)</option>
          <option value="low">Low (&lt;70%)</option>
        </select>
      </div>

      {rowsLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={query ? SpyglassIcon : ShipLogIcon}
          title={query ? "No matching records" : "No records yet"}
          description={query ? "Try a different search term or filter." : "This dataset hasn't finished collecting records."}
        />
      ) : (
        <DataTable
          fields={dataset.fields}
          rows={rows}
          page={page}
          pageSize={PAGE_SIZE}
          total={totalRows}
          selected={selected}
          sort={sort}
          onSort={handleSort}
          onToggleRow={toggleRow}
          onToggleAll={toggleAll}
          onOpenRow={openRow}
          onPageChange={setPage}
        />
      )}

      <SourceDrawer
        row={activeRow}
        sources={activeSources}
        fields={dataset.fields}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}
