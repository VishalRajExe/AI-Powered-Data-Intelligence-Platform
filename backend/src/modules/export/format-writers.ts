import fs from "node:fs";
import crypto from "node:crypto";
import ExcelJS from "exceljs";
import type { DatasetColumnSummary } from "./export.types.js";

/**
 * Escapes a single cell value for RFC 4180 CSV compliance.
 * - Encloses in double quotes if the value contains commas, double quotes, or newlines.
 * - Doubles internal double quotes (" -> "").
 * - Null/undefined values become empty strings.
 */
export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") return Number.isFinite(val) ? String(val) : "";
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "object") {
    const jsonStr = JSON.stringify(val);
    return `"${jsonStr.replace(/"/g, '""')}"`;
  }
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export interface StreamWriteOptions {
  targetPath: string;
  columns: DatasetColumnSummary[];
  getRowsChunk: (skip: number, take: number) => Promise<Record<string, unknown>[]>;
  chunkSize?: number;
}

export interface StreamWriteResult {
  rowCount: number;
  fileSize: number;
  checksumSha256: string;
}

/**
 * Streams dataset rows to a CSV file in chunks without loading the whole dataset into memory.
 */
export async function writeCsvStream(options: StreamWriteOptions): Promise<StreamWriteResult> {
  const { targetPath, columns, getRowsChunk, chunkSize = 500 } = options;
  const writeStream = fs.createWriteStream(targetPath, { encoding: "utf8" });
  const hash = crypto.createHash("sha256");

  // Helper to write to file and hash simultaneously with backpressure handling
  const writeChunk = async (chunk: string): Promise<void> => {
    hash.update(chunk, "utf8");
    if (!writeStream.write(chunk)) {
      await new Promise<void>((resolve) => writeStream.once("drain", resolve));
    }
  };

  // Write header line (using column labels or keys)
  const headerLine = columns.map((c) => escapeCsvCell(c.label || c.key)).join(",") + "\r\n";
  await writeChunk(headerLine);

  let skip = 0;
  let rowCount = 0;

  while (true) {
    const rows = await getRowsChunk(skip, chunkSize);
    if (rows.length === 0) break;

    for (const row of rows) {
      const line =
        columns
          .map((c) => {
            const rawVal = row[c.key];
            return escapeCsvCell(rawVal);
          })
          .join(",") + "\r\n";
      await writeChunk(line);
      rowCount++;
    }

    skip += rows.length;
    if (rows.length < chunkSize) break;
  }

  await new Promise<void>((resolve, reject) => {
    writeStream.end(() => resolve());
    writeStream.on("error", reject);
  });

  const stats = fs.statSync(targetPath);
  return {
    rowCount,
    fileSize: stats.size,
    checksumSha256: hash.digest("hex"),
  };
}

/**
 * Streams dataset rows to a valid JSON file in chunks without loading the whole dataset into memory.
 * Output format is an array of objects:
 * [
 *   { "col1": "val1", ... },
 *   { "col1": "val2", ... }
 * ]
 */
export async function writeJsonStream(options: StreamWriteOptions): Promise<StreamWriteResult> {
  const { targetPath, columns, getRowsChunk, chunkSize = 500 } = options;
  const writeStream = fs.createWriteStream(targetPath, { encoding: "utf8" });
  const hash = crypto.createHash("sha256");

  const writeChunk = async (chunk: string): Promise<void> => {
    hash.update(chunk, "utf8");
    if (!writeStream.write(chunk)) {
      await new Promise<void>((resolve) => writeStream.once("drain", resolve));
    }
  };

  await writeChunk("[\n");

  let skip = 0;
  let rowCount = 0;
  let isFirstRow = true;

  while (true) {
    const rows = await getRowsChunk(skip, chunkSize);
    if (rows.length === 0) break;

    for (const row of rows) {
      const rowObject: Record<string, unknown> = {};
      for (const col of columns) {
        rowObject[col.key] = row[col.key] ?? null;
      }

      const prefix = isFirstRow ? "  " : ",\n  ";
      await writeChunk(prefix + JSON.stringify(rowObject));
      isFirstRow = false;
      rowCount++;
    }

    skip += rows.length;
    if (rows.length < chunkSize) break;
  }

  await writeChunk("\n]\n");

  await new Promise<void>((resolve, reject) => {
    writeStream.end(() => resolve());
    writeStream.on("error", reject);
  });

  const stats = fs.statSync(targetPath);
  return {
    rowCount,
    fileSize: stats.size,
    checksumSha256: hash.digest("hex"),
  };
}

/**
 * Formats a raw value into a type appropriate for an ExcelJS cell.
 */
function formatCellForXlsx(val: unknown, type?: string): ExcelJS.CellValue {
  if (val === null || val === undefined) return null;
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  if (val instanceof Date) return val;

  if (type === "NUMBER" || type === "CURRENCY") {
    const n = Number(val);
    if (!Number.isNaN(n)) return n;
  }

  if (type === "DATE" || type === "DATETIME") {
    const d = new Date(String(val));
    if (!Number.isNaN(d.getTime())) return d;
  }

  if (typeof val === "object") {
    return JSON.stringify(val);
  }

  return String(val);
}

/**
 * Streams dataset rows to an OpenXML XLSX spreadsheet using ExcelJS streaming writer.
 * Commits each row to release memory immediately, preventing heap exhaustion.
 */
export async function writeXlsxStream(options: StreamWriteOptions): Promise<StreamWriteResult> {
  const { targetPath, columns, getRowsChunk, chunkSize = 500 } = options;

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: targetPath,
    useStyles: true,
    useSharedStrings: true,
  });

  const worksheet = workbook.addWorksheet("Dataset");

  // Define headers and column keys
  worksheet.columns = columns.map((col) => ({
    header: col.label || col.key,
    key: col.key,
    width: Math.max(14, Math.min(40, (col.label || col.key).length + 4)),
  }));

  let skip = 0;
  let rowCount = 0;

  while (true) {
    const rows = await getRowsChunk(skip, chunkSize);
    if (rows.length === 0) break;

    for (const row of rows) {
      const rowData: Record<string, ExcelJS.CellValue> = {};
      for (const col of columns) {
        rowData[col.key] = formatCellForXlsx(row[col.key], col.type);
      }
      worksheet.addRow(rowData).commit();
      rowCount++;
    }

    skip += rows.length;
    if (rows.length < chunkSize) break;
  }

  await worksheet.commit();
  await workbook.commit();

  const stats = fs.statSync(targetPath);
  const fileBuffer = fs.readFileSync(targetPath);
  const checksumSha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");

  return {
    rowCount,
    fileSize: stats.size,
    checksumSha256,
  };
}
