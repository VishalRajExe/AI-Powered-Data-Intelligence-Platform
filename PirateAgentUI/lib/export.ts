import type { DatasetRow } from "./types";

function triggerDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function columns(rows: DatasetRow[]) {
  const set = new Set<string>();
  rows.forEach((r) => Object.keys(r.data).forEach((k) => set.add(k)));
  return Array.from(set);
}

export function exportCSV(rows: DatasetRow[], name: string) {
  const cols = columns(rows);
  const header = [...cols, "confidence", "sources"].join(",");
  const lines = rows.map((r) =>
    [...cols.map((c) => `"${String(r.data[c] ?? "").replace(/"/g, '""')}"`), r.confidence, r.sourceIds.length].join(",")
  );
  triggerDownload([header, ...lines].join("\n"), `${slug(name)}.csv`, "text/csv;charset=utf-8;");
}

export function exportJSON(rows: DatasetRow[], name: string) {
  const payload = rows.map((r) => ({ ...r.data, confidence: r.confidence, sources: r.sourceIds.length }));
  triggerDownload(JSON.stringify(payload, null, 2), `${slug(name)}.json`, "application/json");
}

export function exportExcel(rows: DatasetRow[], name: string) {
  const cols = columns(rows);
  const headerRow = `<tr>${[...cols, "Confidence", "Sources"].map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
  const bodyRows = rows
    .map(
      (r) =>
        `<tr>${[...cols.map((c) => `<td>${escapeHtml(String(r.data[c] ?? ""))}</td>`), `<td>${r.confidence}%</td>`, `<td>${r.sourceIds.length}</td>`].join("")}</tr>`
    )
    .join("");
  const html = `<html><head><meta charset="utf-8" /></head><body><table border="1">${headerRow}${bodyRows}</table></body></html>`;
  triggerDownload(html, `${slug(name)}.xls`, "application/vnd.ms-excel");
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
