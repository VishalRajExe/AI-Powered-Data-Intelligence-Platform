import fs from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import type { DatasetQueryRepository } from "../../db/repositories/dataset-query.repository.js";
import type { ExportRepository } from "../../db/repositories/export.repository.js";
import { AppError } from "../../common/errors.js";
import type {
  CreateExportInput,
  DatasetColumnSummary,
  ExportFileMetadata,
  ExportFilterDefinition,
  ExportFormat,
  ExportJobView,
} from "./export.types.js";
import { writeCsvStream, writeJsonStream, writeXlsxStream } from "./format-writers.js";

export interface ExportServiceOptions {
  logger?: Logger;
  chunkSize?: number;
  waitForCompletionInTests?: boolean;
}

export class ExportService {
  private readonly chunkSize: number;
  private readonly activeJobs = new Map<string, Promise<void>>();

  constructor(
    private readonly exportRepository: ExportRepository,
    private readonly datasetQueryRepository: DatasetQueryRepository,
    private readonly options: ExportServiceOptions = {},
  ) {
    this.chunkSize = options.chunkSize ?? 500;
  }

  async createAndProcessExport(
    input: CreateExportInput,
    waitForCompletion = false,
  ): Promise<ExportJobView> {
    const jobView = await this.exportRepository.createExportJob(input);

    const task = this.processExportJob(
      jobView.id,
      input.workspaceId,
      input.datasetId,
      input.userId,
      input.format,
      input.filterDefinition,
    );

    this.activeJobs.set(jobView.id, task);
    task.finally(() => {
      this.activeJobs.delete(jobView.id);
    });

    if (waitForCompletion || this.options.waitForCompletionInTests) {
      await task;
      return this.exportRepository.getExportJob(input.workspaceId, jobView.id, input.userId);
    }

    return jobView;
  }

  async waitForJob(
    workspaceId: string,
    jobId: string,
    userId: string,
    timeoutMs = 10_000,
  ): Promise<ExportJobView> {
    const task = this.activeJobs.get(jobId);
    if (task) {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout waiting for export job")), timeoutMs),
      );
      await Promise.race([task, timeout]);
    }
    return this.exportRepository.getExportJob(workspaceId, jobId, userId);
  }

  async processExportJob(
    jobId: string,
    workspaceId: string,
    datasetId: string,
    userId: string,
    format: ExportFormat,
    filterDefinition?: ExportFilterDefinition,
  ): Promise<void> {
    let targetPath = "";

    try {
      await this.exportRepository.updateJobRunning(jobId);

      // 1. Fetch dataset details and columns
      const dataset = (await this.datasetQueryRepository.getDataset(
        workspaceId,
        datasetId,
        userId,
      )) as {
        name: string;
        columns: Array<{ key: string; label: string; type: string; position: number }>;
      };

      if (!dataset) {
        throw new AppError("Dataset not found", 404, "DATASET_NOT_FOUND");
      }

      // 2. Determine active columns
      let activeColumns: DatasetColumnSummary[] = dataset.columns.map((c) => ({
        key: c.key,
        label: c.label,
        type: c.type,
        position: c.position,
      }));

      if (filterDefinition?.columns && filterDefinition.columns.length > 0) {
        const requestedKeys = new Set(filterDefinition.columns);
        const filtered = activeColumns.filter((c) => requestedKeys.has(c.key));
        if (filtered.length > 0) {
          activeColumns = filtered;
        }
      }

      // 3. Prepare target file path
      const sanitizedName = (dataset.name || "dataset")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 30);

      const ext = format === "XLSX" ? "xlsx" : format.toLowerCase();
      const fileName = `${sanitizedName}-${jobId.slice(0, 8)}.${ext}`;
      targetPath = path.resolve(this.exportRepository.getStorageDir(), fileName);

      // 4. Build chunk getter using DatasetQueryRepository
      const getRowsChunk = async (
        skip: number,
        take: number,
      ): Promise<Record<string, unknown>[]> => {
        const page = Math.floor(skip / take) + 1;
        const result = await this.datasetQueryRepository.getDatasetRows(
          workspaceId,
          datasetId,
          userId,
          {
            page,
            limit: take,
            ...(filterDefinition?.search ? { search: filterDefinition.search } : {}),
            ...(filterDefinition?.validOnly !== undefined
              ? { validOnly: filterDefinition.validOnly }
              : {}),
            ...(filterDefinition?.duplicatesOnly !== undefined
              ? { duplicatesOnly: filterDefinition.duplicatesOnly }
              : {}),
            ...(filterDefinition?.verificationStatus
              ? { verificationStatus: filterDefinition.verificationStatus }
              : {}),
            ...(filterDefinition?.confidenceMin !== undefined
              ? { confidenceMin: filterDefinition.confidenceMin }
              : {}),
            ...(filterDefinition?.confidenceMax !== undefined
              ? { confidenceMax: filterDefinition.confidenceMax }
              : {}),
            ...(filterDefinition?.sourceId ? { sourceId: filterDefinition.sourceId } : {}),
            ...(filterDefinition?.fieldFilters
              ? { fieldFilters: filterDefinition.fieldFilters }
              : {}),
            ...(filterDefinition?.sort?.field ? { sort: filterDefinition.sort.field } : {}),
            ...(filterDefinition?.sort?.order ? { order: filterDefinition.sort.order } : {}),
          },
        );

        return (
          result.data as Array<{
            id: string;
            values: Record<string, unknown>;
          }>
        ).map((r) => ({
          id: r.id,
          ...(typeof r.values === "object" && r.values !== null ? r.values : {}),
        }));
      };

      // 5. Execute streaming format write
      let writeResult: { rowCount: number; fileSize: number; checksumSha256: string };
      let contentType = "";

      switch (format) {
        case "CSV":
          contentType = "text/csv; charset=utf-8";
          writeResult = await writeCsvStream({
            targetPath,
            columns: activeColumns,
            getRowsChunk,
            chunkSize: this.chunkSize,
          });
          break;

        case "JSON":
          contentType = "application/json; charset=utf-8";
          writeResult = await writeJsonStream({
            targetPath,
            columns: activeColumns,
            getRowsChunk,
            chunkSize: this.chunkSize,
          });
          break;

        case "XLSX":
          contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
          writeResult = await writeXlsxStream({
            targetPath,
            columns: activeColumns,
            getRowsChunk,
            chunkSize: this.chunkSize,
          });
          break;

        default:
          throw new AppError(`Unsupported format: ${format}`, 400, "UNSUPPORTED_FORMAT");
      }

      // 6. Complete export job
      const fileMetadata: ExportFileMetadata = {
        fileName,
        fileSize: writeResult.fileSize,
        rowCount: writeResult.rowCount,
        columnCount: activeColumns.length,
        contentType,
        checksumSha256: writeResult.checksumSha256,
        downloadUrl: `/api/v1/exports/${jobId}/download`,
      };

      await this.exportRepository.updateJobCompleted(jobId, fileName, fileMetadata);
      this.options.logger?.info(
        { jobId, format, rowCount: writeResult.rowCount, fileSize: writeResult.fileSize },
        "Export job completed successfully",
      );
    } catch (error) {
      if (targetPath && fs.existsSync(targetPath)) {
        try {
          fs.rmSync(targetPath, { force: true });
        } catch {
          // ignore cleanup errors
        }
      }

      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const errorCode = error instanceof AppError ? error.code : "EXPORT_FAILED";

      await this.exportRepository.updateJobFailed(jobId, errorCode, errorMessage);
      this.options.logger?.error({ jobId, err: error }, "Export job failed");
    }
  }
}
