"use client";
import { useState } from "react";
import { Download, FileSpreadsheet, FileJson, FileText, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";

interface ExportMenuProps {
  datasetId: string;
  name: string;
  count: number;
}

export function ExportMenu({ datasetId, name, count }: ExportMenuProps) {
  const { user } = useAuth();
  const [exporting, setExporting] = useState<string | null>(null);

  async function handleExport(format: "CSV" | "JSON" | "XLSX") {
    if (!user) return;
    setExporting(format);

    try {
      // Create export job with waitForCompletion
      const job = await api.post<{ id: string; status: string }>(`/datasets/${datasetId}/exports`, {
        format,
        workspaceId: user.workspaceId,
        userId: user.id,
        waitForCompletion: true,
      });

      // Download the file
      const response = await api.download(`/exports/${job.id}/download`, {
        workspaceId: user.workspaceId,
        userId: user.id,
      });

      // Trigger browser download
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${format.toLowerCase()}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(null);
    }
  }

  const label = count > 0 ? `Export ${count} selected` : "Export all";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 bg-card border-border/80 font-semibold"
          disabled={!!exporting}
        >
          {exporting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Exporting…
            </>
          ) : (
            <>
              <Download className="h-3.5 w-3.5" /> {label}
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-card border-border shadow-md">
        <DropdownMenuItem
          onClick={() => handleExport("CSV")}
          className="cursor-pointer hover:bg-muted/50"
        >
          <FileText className="h-3.5 w-3.5 mr-2 text-muted-foreground" /> CSV
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleExport("JSON")}
          className="cursor-pointer hover:bg-muted/50"
        >
          <FileJson className="h-3.5 w-3.5 mr-2 text-muted-foreground" /> JSON
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleExport("XLSX")}
          className="cursor-pointer hover:bg-muted/50"
        >
          <FileSpreadsheet className="h-3.5 w-3.5 mr-2 text-muted-foreground" /> Excel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
