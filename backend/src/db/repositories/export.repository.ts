import fs from "node:fs";
import path from "node:path";
import type { PrismaClient, ExportJob, Prisma } from "@prisma/client";
import { AppError } from "../../common/errors.js";
import type {
  CreateExportInput,
  ExportFileMetadata,
  ExportFilterDefinition,
  ExportJobView,
} from "../../modules/export/export.types.js";

export class ExportRepository {
  private readonly storageDir: string;

  constructor(
    private readonly prisma: PrismaClient,
    storageDir?: string,
  ) {
    this.storageDir = storageDir ?? path.resolve(process.cwd(), "storage", "exports");
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  getStorageDir(): string {
    return this.storageDir;
  }

  // ── Access guard ──────────────────────────────────────────────────────────

  private async assertAccess(workspaceId: string, userId: string): Promise<void> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { status: true },
    });
    if (member?.status !== "ACTIVE") {
      throw new AppError("Active workspace membership is required", 403, "WORKSPACE_ACCESS_DENIED");
    }
  }

  // ── Create job ────────────────────────────────────────────────────────────

  async createExportJob(input: CreateExportInput): Promise<ExportJobView> {
    await this.assertAccess(input.workspaceId, input.userId);

    const dataset = await this.prisma.dataset.findFirst({
      where: { workspaceId: input.workspaceId, id: input.datasetId },
      select: { id: true, name: true },
    });
    if (!dataset) {
      throw new AppError("Dataset not found", 404, "DATASET_NOT_FOUND");
    }

    const filtersJson = input.filterDefinition
      ? (input.filterDefinition as unknown as Prisma.InputJsonValue)
      : undefined;

    const sortJson = input.filterDefinition?.sort
      ? (input.filterDefinition.sort as unknown as Prisma.InputJsonValue)
      : undefined;

    const created = await this.prisma.exportJob.create({
      data: {
        workspaceId: input.workspaceId,
        datasetId: input.datasetId,
        requestedById: input.userId,
        format: input.format,
        status: "PENDING",
        ...(filtersJson !== undefined ? { filters: filtersJson } : {}),
        ...(sortJson !== undefined ? { sort: sortJson } : {}),
      },
    });

    return this.mapToView(created);
  }

  // ── Get job ───────────────────────────────────────────────────────────────

  async getExportJob(workspaceId: string, jobId: string, userId: string): Promise<ExportJobView> {
    await this.assertAccess(workspaceId, userId);

    const job = await this.prisma.exportJob.findFirst({
      where: { workspaceId, id: jobId },
    });
    if (!job) {
      throw new AppError("Export job not found", 404, "EXPORT_NOT_FOUND");
    }

    return this.mapToView(job);
  }

  // ── Get job for download ──────────────────────────────────────────────────

  async getExportJobForDownload(
    workspaceId: string,
    jobId: string,
    userId: string,
  ): Promise<{ job: ExportJobView; absolutePath: string }> {
    await this.assertAccess(workspaceId, userId);

    const job = await this.prisma.exportJob.findFirst({
      where: { workspaceId, id: jobId },
    });
    if (!job) {
      throw new AppError("Export job not found", 404, "EXPORT_NOT_FOUND");
    }

    if (job.status !== "COMPLETED") {
      throw new AppError(
        `Export job is not ready for download. Current status: ${job.status}`,
        400,
        "EXPORT_NOT_READY",
        { status: job.status },
      );
    }

    if (!job.fileKey) {
      throw new AppError("Export file record is missing file key", 404, "EXPORT_FILE_NOT_FOUND");
    }

    const absolutePath = path.isAbsolute(job.fileKey)
      ? job.fileKey
      : path.resolve(this.storageDir, job.fileKey);

    if (!fs.existsSync(absolutePath)) {
      throw new AppError("Export file not found on disk", 404, "EXPORT_FILE_NOT_FOUND");
    }

    return { job: this.mapToView(job), absolutePath };
  }

  // ── Status updates ────────────────────────────────────────────────────────

  async updateJobRunning(jobId: string): Promise<void> {
    await this.prisma.exportJob.update({
      where: { id: jobId },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
      },
    });
  }

  async updateJobCompleted(
    jobId: string,
    fileKey: string,
    fileMetadata: ExportFileMetadata,
  ): Promise<void> {
    await this.prisma.exportJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        finishedAt: new Date(),
        fileKey,
        fileMetadata: fileMetadata as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async updateJobFailed(jobId: string, errorCode: string, errorMessage: string): Promise<void> {
    await this.prisma.exportJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorCode,
        errorMessage,
      },
    });
  }

  // ── Mapping ───────────────────────────────────────────────────────────────

  mapToView(job: ExportJob): ExportJobView {
    const rawFilters = job.filters as unknown as ExportFilterDefinition | null;
    const rawMetadata = job.fileMetadata as unknown as ExportFileMetadata | null;

    let errorObj: { code: string; message: string } | string | null = null;
    if (job.errorCode || job.errorMessage) {
      errorObj = {
        code: job.errorCode ?? "EXPORT_ERROR",
        message: job.errorMessage ?? "An error occurred during export",
      };
    }

    const fileMeta: ExportFileMetadata | null = rawMetadata
      ? {
          fileName: rawMetadata.fileName,
          fileSize: rawMetadata.fileSize,
          rowCount: rawMetadata.rowCount,
          columnCount: rawMetadata.columnCount,
          contentType: rawMetadata.contentType,
          ...(rawMetadata.checksumSha256 ? { checksumSha256: rawMetadata.checksumSha256 } : {}),
          downloadUrl: `/api/v1/exports/${job.id}/download`,
        }
      : null;

    return {
      id: job.id,
      datasetId: job.datasetId,
      format: job.format,
      filterDefinition: rawFilters ?? null,
      status: job.status,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
      error: errorObj,
      fileMetadata: fileMeta,
      downloadUrl: job.status === "COMPLETED" ? `/api/v1/exports/${job.id}/download` : undefined,
    };
  }
}
