"use client";
import { useEffect, useState } from "react";
import { ExternalLink, ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import { LighthouseIcon, SpyglassIcon } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/common/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/common/pagination";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";
import type { SourceRecord } from "@/lib/types";

const RELIABILITY_ICON = { high: ShieldCheck, medium: ShieldAlert, low: ShieldX } as const;
const RELIABILITY_TONE = { high: "text-success", medium: "text-warning", low: "text-danger" } as const;

interface SourcesPageData {
  data: SourceRecord[];
  pagination: { total: number };
}

interface DatasetItem {
  id: string;
  name: string;
}

interface DatasetListResponse {
  data: DatasetItem[];
}

export default function SourcesPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<SourceRecord | null>(null);
  const [open, setOpen] = useState(false);
  const [allSources, setAllSources] = useState<SourceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // First get all datasets, then fetch sources for each
  const { data: datasetsData } = useApi<DatasetListResponse>(
    user ? "/datasets" : null,
    { workspaceId: user?.workspaceId ?? "", userId: user?.id ?? "", limit: 50 },
    { skip: !user },
  );

  useEffect(() => {
    if (!datasetsData?.data || !user) return;
    setLoading(true);

    const fetchPromises = datasetsData.data.map((ds) =>
      api
        .get<SourcesPageData>(`/datasets/${ds.id}/sources`, {
          workspaceId: user.workspaceId,
          userId: user.id,
          limit: 100,
        })
        .then((res) => res.data ?? [])
        .catch(() => [] as SourceRecord[]),
    );

    Promise.all(fetchPromises)
      .then((results) => {
        // Deduplicate by ID
        const map = new Map<string, SourceRecord>();
        for (const sources of results) {
          for (const s of sources) {
            if (!map.has(s.id)) map.set(s.id, s);
          }
        }
        setAllSources(Array.from(map.values()));
      })
      .finally(() => setLoading(false));
  }, [datasetsData, user]);

  const filtered = allSources.filter(
    (s) =>
      (s.domain ?? "").toLowerCase().includes(query.toLowerCase()) ||
      (s.title ?? "").toLowerCase().includes(query.toLowerCase()),
  );

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedSources = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  function openSource(s: SourceRecord) {
    setActive(s);
    setOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-tan mb-1">
            <LighthouseIcon className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              BEACONS &amp; PORTS
            </span>
          </div>
          <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            Sources
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Web locations visited during missions, verified for data provenance.
          </p>
        </div>

        <div className="relative w-full max-w-[260px]">
          <SpyglassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search sources…"
            className="h-8 pl-8 text-[13px] bg-card border-border/80"
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={LighthouseIcon}
          title="No sources found"
          description="Try a different search term or check mission parameters."
        />
      ) : (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-border bg-card shadow-subtle">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-surface/90 border-b border-border">
                <tr>
                  <th className="px-3.5 py-3 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">Source</th>
                  <th className="px-3.5 py-3 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">Type</th>
                  <th className="px-3.5 py-3 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">Records</th>
                  <th className="px-3.5 py-3 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="px-3.5 py-3 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">Reliability</th>
                  <th className="px-3.5 py-3 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">Last visited</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {paginatedSources.map((s) => {
                  const reliability = (s.reliability ?? "medium") as keyof typeof RELIABILITY_ICON;
                  const RelIcon = RELIABILITY_ICON[reliability] ?? ShieldAlert;
                  return (
                    <tr
                      key={s.id}
                      onClick={() => openSource(s)}
                      className="cursor-pointer transition-colors hover:bg-surface/60"
                    >
                      <td className="px-3.5 py-3">
                        <p className="max-w-[260px] truncate font-semibold text-foreground">{s.title}</p>
                        <p className="max-w-[260px] truncate text-[12px] text-muted-foreground">{s.domain}</p>
                      </td>
                      <td className="px-3.5 py-3 text-muted-foreground">{s.type}</td>
                      <td className="px-3.5 py-3 font-medium text-foreground">{s.recordsContributed ?? 0}</td>
                      <td className="px-3.5 py-3">
                        <Badge variant={s.status === "accepted" ? "success" : "default"}>
                          {s.status === "accepted" ? "Accepted" : "Skipped"}
                        </Badge>
                      </td>
                      <td className="px-3.5 py-3">
                        <RelIcon className={`h-4 w-4 ${RELIABILITY_TONE[reliability] ?? "text-warning"}`} />
                      </td>
                      <td className="px-3.5 py-3 text-muted-foreground">{s.retrievedAt ? formatRelativeTime(s.retrievedAt) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            currentPage={safePage}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={pageSize}
            itemLabel="sources"
            onPageChange={(p) => setPage(p)}
          />
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        {active && (
          <SheetContent className="bg-card border-border shadow-xl">
            <div className="p-6">
              <SheetTitle className="font-serif text-2xl font-bold tracking-tight text-foreground">
                {active.title}
              </SheetTitle>
              <a
                href={active.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 flex items-center gap-1.5 text-[13px] text-primary hover:underline font-medium"
              >
                {active.url} <ExternalLink className="h-3 w-3" />
              </a>

              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant={active.status === "accepted" ? "success" : "default"}>
                  {active.status === "accepted" ? "Accepted" : "Skipped"}
                </Badge>
                <Badge variant="default">{active.type}</Badge>
                <Badge variant="default" className="capitalize">
                  {active.reliability ?? "medium"} reliability
                </Badge>
              </div>

              {active.status === "skipped" && active.reason && (
                <div className="mt-4 rounded-lg bg-warning-soft border border-warning/20 p-3 text-[12.5px] text-warning font-medium">
                  {active.reason}
                </div>
              )}

              <Separator className="my-5 bg-border/60" />

              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Source summary</p>
              <p className="text-[13px] text-foreground/85 leading-relaxed">{active.snippet}</p>
            </div>
          </SheetContent>
        )}
      </Sheet>
    </div>
  );
}
