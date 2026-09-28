import fs from "node:fs";
import { Router } from "express";
import { z } from "zod";
import { validateRequest } from "../common/validateRequest.js";
import type { ExportRepository } from "../db/repositories/export.repository.js";
import type { ExportService } from "../modules/export/export.service.js";
import type { ExportFormat } from "../modules/export/export.types.js";

// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------

const UUIDParam = z.object({ id: z.string().uuid() });

const WorkspaceAccessQuery = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
});

const ExportFormatEnum = z.preprocess(
  (val) => (typeof val === "string" ? val.toUpperCase() : val),
  z.enum(["CSV", "JSON", "XLSX"]),
);

const CreateExportBody = z.object({
  workspaceId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  format: ExportFormatEnum,
  columns: z.array(z.string().min(1)).optional(),
  filterDefinition: z
    .object({
      columns: z.array(z.string().min(1)).optional(),
      search: z.string().trim().max(500).optional(),
      validOnly: z.boolean().optional(),
      duplicatesOnly: z.boolean().optional(),
      verificationStatus: z
        .enum(["SOURCE_CITED_UNVERIFIED", "UNSUPPORTED", "CONFLICTED"])
        .optional(),
      confidenceMin: z.number().min(0).max(1).optional(),
      confidenceMax: z.number().min(0).max(1).optional(),
      sourceId: z.string().uuid().optional(),
      fieldFilters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      sort: z
        .object({
          field: z.enum(["createdAt", "confidence", "collectedAt"]).optional(),
          order: z.enum(["asc", "desc"]).optional(),
        })
        .optional(),
    })
    .optional(),
  waitForCompletion: z.boolean().optional(),
});

const CreateExportQuery = z.object({
  workspaceId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Router Factory
// ---------------------------------------------------------------------------

export function createExportsRouter(
  exportRepository: ExportRepository,
  exportService: ExportService,
): Router {
  const router = Router();

  // POST /api/v1/datasets/:id/exports
  router.post(
    "/datasets/:id/exports",
    validateRequest({
      params: UUIDParam,
      body: CreateExportBody,
      query: CreateExportQuery,
    }),
    async (_req, res) => {
      const { params, body, query } = res.locals.validated as {
        params: z.infer<typeof UUIDParam>;
        body: z.infer<typeof CreateExportBody>;
        query: z.infer<typeof CreateExportQuery>;
      };

      const workspaceId = body.workspaceId ?? query.workspaceId;
      const userId = body.userId ?? query.userId;

      if (!workspaceId || !userId) {
        res.status(400).json({
          error: "WORKSPACE_AND_USER_REQUIRED",
          message: "Both workspaceId and userId must be provided in body or query parameters",
        });
        return;
      }

      // Merge columns from top-level body into filterDefinition if present
      const filterDef = {
        ...(body.filterDefinition ?? {}),
        ...(body.columns && body.columns.length > 0
          ? { columns: body.columns }
          : body.filterDefinition?.columns
            ? { columns: body.filterDefinition.columns }
            : {}),
      };

      const job = await exportService.createAndProcessExport(
        {
          workspaceId,
          userId,
          datasetId: params.id,
          format: body.format as ExportFormat,
          filterDefinition: Object.keys(filterDef).length > 0 ? filterDef : undefined,
        },
        Boolean(body.waitForCompletion),
      );

      res.status(202).json(job);
    },
  );

  // GET /api/v1/exports/:id
  router.get(
    "/exports/:id",
    validateRequest({
      params: UUIDParam,
      query: WorkspaceAccessQuery,
    }),
    async (_req, res) => {
      const { params, query } = res.locals.validated as {
        params: z.infer<typeof UUIDParam>;
        query: z.infer<typeof WorkspaceAccessQuery>;
      };

      const job = await exportRepository.getExportJob(query.workspaceId, params.id, query.userId);
      res.json(job);
    },
  );

  // GET /api/v1/exports/:id/download
  router.get(
    "/exports/:id/download",
    validateRequest({
      params: UUIDParam,
      query: WorkspaceAccessQuery,
    }),
    async (_req, res) => {
      const { params, query } = res.locals.validated as {
        params: z.infer<typeof UUIDParam>;
        query: z.infer<typeof WorkspaceAccessQuery>;
      };

      const { job, absolutePath } = await exportRepository.getExportJobForDownload(
        query.workspaceId,
        params.id,
        query.userId,
      );

      const fileName = job.fileMetadata?.fileName || `export-${params.id}.${job.format.toLowerCase()}`;
      const contentType = job.fileMetadata?.contentType || "application/octet-stream";
      const stats = fs.statSync(absolutePath);

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("Content-Length", stats.size);

      const readStream = fs.createReadStream(absolutePath);
      readStream.on("error", (err) => {
        if (!res.headersSent) {
          res.status(500).json({ error: "FILE_STREAM_ERROR", message: err.message });
        }
      });
      readStream.pipe(res);
    },
  );

  return router;
}
