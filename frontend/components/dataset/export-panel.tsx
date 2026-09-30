"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { CargoIcon } from "@/components/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ReadError } from "@/components/common/read-error";
import { EmptyState } from "@/components/common/empty-state";
import { exportsApi } from "@/lib/api/endpoints";
import { useAuth } from "@/lib/auth";
import { useLive } from "@/hooks/use-live";
import { ApiError } from "@/lib/api/client";
import { formatNumber } from "@/lib/utils";
import type { ExportView } from "@/lib/api/types";

const FORMATS = ["csv", "json", "xlsx"] as const;
const POLL_MS = 3000;

/**
 * Exports of one dataset, as queued jobs.
 *
 * An export is a row the worker writes; the percentage here is the queue's own measurement, capped
 * at 99 until the written count reaches the count taken when the job was requested. Nothing in this
 * panel estimates progress from the file having been asked for.
 */
export function ExportPanel({ datasetId }: { datasetId: string }) {
  const { canWrite } = useAuth();
  const [format, setFormat] = useState<(typeof FORMATS)[number]>("csv");
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState<ExportView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) => exportsApi.list({ datasetId, limit: 20 }, signal),
    [datasetId]
  );
  const { data, error: listError, reload } = useLive(load);
  const rows = data?.exports ?? [];

  const busy = rows.some((row) => row.status === "QUEUED" || row.status === "RUNNING");
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [busy, reload]);

  async function request() {
    setRequesting(true);
    setError(null);
    setRequested(null);
    try {
      const result = await exportsApi.request(datasetId, { format });
      setRequested(result.export);
      reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : new ApiError(String(cause), { code: "UNEXPECTED" }));
    } finally {
      setRequesting(false);
    }
  }

  async function cancel(id: string) {
    setError(null);
    try {
      await exportsApi.cancel(id);
    } catch (cause) {
      if (cause instanceof ApiError) setError(cause);
    }
    reload();
  }

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card shadow-subtle">
        <CardHeader className="pb-3">
          <CardTitle className="font-serif text-lg font-bold tracking-tight">Request an export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {FORMATS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFormat(value)}
                className={`rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors ${
                  format === value
                    ? "border-tan bg-surface text-foreground"
                    : "border-border/80 bg-surface/70 text-muted-foreground hover:text-foreground"
                }`}
              >
                {value.toUpperCase()}
              </button>
            ))}
            <Button
              size="sm"
              className="ml-auto"
              loading={requesting}
              disabled={!canWrite}
              onClick={request}
            >
              Queue {format.toUpperCase()} export
            </Button>
          </div>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            The whole dataset is written, not the page on screen. The file is published only after the
            writer finishes every row and records a SHA-256 of what it wrote.
          </p>
          {!canWrite && (
            <p className="text-[12px] text-warning">
              This workspace role is read-only, so the queue request would be refused with{" "}
              <span className="font-mono text-[11.5px]">WORKSPACE_WRITE_FORBIDDEN</span>.
            </p>
          )}
        </CardContent>
      </Card>

      {error && <ReadError error={error} label="Export request failed" />}
      {listError && <ReadError error={listError} label="Export history unavailable" onRetry={reload} />}

      {requested && (
        <p className="text-[12.5px] text-muted-foreground">
          Queued <span className="font-mono text-[12px] text-foreground">{requested.id}</span> as{" "}
          {requested.status.toLowerCase()}.
        </p>
      )}

      <Card className="border-border bg-card shadow-subtle">
        <CardHeader className="pb-3">
          <CardTitle className="font-serif text-lg font-bold tracking-tight">
            This dataset&apos;s exports
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              icon={CargoIcon}
              title="No exports yet"
              description="Nothing has been written for this dataset. Queuing one above creates a job the worker will claim."
            />
          ) : (
            <ul className="space-y-3">
              {rows.map((row) => (
                <li key={row.id} className="rounded-md border border-border/60 bg-surface/40 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-foreground">{row.id}</span>
                    <Badge variant="primary">{row.format?.toUpperCase()}</Badge>
                    <Badge
                      variant={
                        row.status === "COMPLETED"
                          ? "success"
                          : row.status === "FAILED"
                            ? "danger"
                            : row.status === "CANCELLED"
                              ? "default"
                              : "info"
                      }
                    >
                      {row.status}
                    </Badge>
                    <span className="text-[11.5px] text-muted-foreground">
                      {formatNumber(row.writtenRows ?? 0)} of {formatNumber(row.totalRows ?? 0)} rows
                      {row.fileName ? ` · ${row.fileName}` : ""}
                      {typeof row.fileSizeBytes === "number" ? ` · ${formatNumber(row.fileSizeBytes)} bytes` : ""}
                    </span>
                    {row.status === "COMPLETED" && (
                      <a
                        href={exportsApi.downloadHref(row.id)}
                        className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[12px] font-semibold text-foreground hover:border-tan"
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </a>
                    )}
                    {(row.status === "QUEUED" || row.status === "RUNNING") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto gap-1.5 text-danger"
                        disabled={!canWrite}
                        onClick={() => cancel(row.id)}
                      >
                        <X className="h-3.5 w-3.5" /> Cancel
                      </Button>
                    )}
                  </div>

                  <div className="mt-2">
                    <Progress value={row.progressPercent ?? 0} />
                  </div>

                  {row.checksum && (
                    <p className="mt-1.5 font-mono text-[10.5px] text-muted-foreground">
                      sha256 {row.checksum}
                    </p>
                  )}
                  {(row.errorCode || row.errorMessage) && (
                    <p className="mt-1.5 text-[11.5px] font-medium text-danger">
                      {row.errorCode && <span className="font-mono">{row.errorCode} </span>}
                      {row.errorMessage}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
