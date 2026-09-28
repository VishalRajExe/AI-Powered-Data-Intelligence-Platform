import { Router } from "express";
import { z } from "zod";
import { validateRequest } from "../common/validateRequest.js";
import type { DatasetQueryRepository, SortOrder } from "../db/repositories/dataset-query.repository.js";

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

const UUIDParam = z.object({ id: z.string().uuid() });
const RowIdParams = z.object({ id: z.string().uuid(), rowId: z.string().uuid() });

/** Every dataset endpoint requires workspace + user scoping (auth placeholder). */
const WorkspaceAccess = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
});

const Pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

const SortOrderEnum = z.enum(["asc", "desc"]).default("desc");

const BooleanQuery = z.preprocess((val) => {
  if (typeof val === "boolean") return val;
  if (val === "true" || val === "1") return true;
  if (val === "false" || val === "0") return false;
  return undefined;
}, z.boolean().optional());

const FieldFilterRecord = z.record(
  z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/, "Filter key must be alphanumeric"),
  z.union([z.string().max(500), z.number(), z.boolean()]),
);

const FieldFilterSchema = z.union([
  FieldFilterRecord,
  z.string().transform((str, ctx) => {
    try {
      const parsed = JSON.parse(str);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Filters must be an object" });
        return z.NEVER;
      }
      return parsed as Record<string, string | number | boolean>;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid JSON format for filters" });
      return z.NEVER;
    }
  }),
]);

// ---------------------------------------------------------------------------
// Endpoint-specific query schemas
// ---------------------------------------------------------------------------

const DatasetListQuery = WorkspaceAccess.merge(Pagination).extend({
  sort: z.enum(["createdAt", "updatedAt", "recordCount"]).default("updatedAt"),
  order: SortOrderEnum,
  search: z.string().trim().max(500).optional(),
}).strict();

const DatasetAccessQuery = WorkspaceAccess.strict();

function normalizeFilterQuery(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const query = { ...(raw as Record<string, unknown>) };
  const extractedFilters: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(query)) {
    const match = key.match(/^(?:filter|filters)\[(.*)\]$/);
    if (match) {
      const fieldKey = match[1] ?? "";
      extractedFilters[fieldKey] = value;
      delete query[key];
    }
  }

  if (Object.keys(extractedFilters).length > 0) {
    query.filters = {
      ...(typeof query.filters === "object" && query.filters !== null ? (query.filters as Record<string, unknown>) : {}),
      ...extractedFilters,
    };
  }

  return query;
}

const DatasetRowsQuery = z.preprocess(
  normalizeFilterQuery,
  WorkspaceAccess.merge(Pagination).extend({
    search: z.string().trim().max(500).optional(),
    validOnly: BooleanQuery,
    duplicatesOnly: BooleanQuery,
    verificationStatus: z
      .enum(["SOURCE_CITED_UNVERIFIED", "UNSUPPORTED", "CONFLICTED"])
      .optional(),
    confidenceMin: z.coerce.number().min(0).max(1).optional(),
    confidenceMax: z.coerce.number().min(0).max(1).optional(),
    sort: z.enum(["createdAt", "confidence", "collectedAt"]).default("createdAt"),
    order: SortOrderEnum,
    sourceId: z.string().uuid().optional(),
    filter: FieldFilterSchema.optional(),
    filters: FieldFilterSchema.optional(),
  }).strict(),
);

const DatasetSourcesQuery = WorkspaceAccess.merge(Pagination).extend({
  order: SortOrderEnum,
  search: z.string().trim().max(500).optional(),
}).strict();

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createDatasetsRouter(repository: DatasetQueryRepository): Router {
  const router = Router();

  // GET /datasets
  router.get(
    "/datasets",
    validateRequest({ query: DatasetListQuery }),
    async (_req, res) => {
      const { query } = res.locals.validated as { query: z.infer<typeof DatasetListQuery> };
      const result = await repository.listDatasets(
        query.workspaceId,
        query.userId,
        { page: query.page, limit: query.limit },
        query.sort,
        query.order as SortOrder,
        query.search,
      );
      res.json(result);
    },
  );

  // GET /datasets/:id
  router.get(
    "/datasets/:id",
    validateRequest({ params: UUIDParam, query: DatasetAccessQuery }),
    async (_req, res) => {
      const { params, query } = res.locals.validated as {
        params: z.infer<typeof UUIDParam>;
        query: z.infer<typeof DatasetAccessQuery>;
      };
      const ds = await repository.getDataset(query.workspaceId, params.id, query.userId);
      const columns = (ds as any).columns ?? [];
      const fields = columns.map((col: any) => ({
        id: col.id,
        name: col.key,
        label: col.label || col.key,
        type: (col.type || "string").toLowerCase(),
        required: col.required ?? true,
        filterable: col.filterable ?? true,
        sortable: col.sortable ?? true,
      }));
      res.json({
        ...ds,
        fields,
      });
    },
  );

  // GET /datasets/:id/schema
  router.get(
    "/datasets/:id/schema",
    validateRequest({ params: UUIDParam, query: DatasetAccessQuery }),
    async (_req, res) => {
      const { params, query } = res.locals.validated as {
        params: z.infer<typeof UUIDParam>;
        query: z.infer<typeof DatasetAccessQuery>;
      };
      res.json(await repository.getDatasetSchema(query.workspaceId, params.id, query.userId));
    },
  );

  // GET /datasets/:id/rows
  router.get(
    "/datasets/:id/rows",
    validateRequest({ params: UUIDParam, query: DatasetRowsQuery }),
    async (_req, res) => {
      const { params, query } = res.locals.validated as {
        params: z.infer<typeof UUIDParam>;
        query: z.infer<typeof DatasetRowsQuery>;
      };

      // Combine filter and filters, then coerce scalar string types if needed
      const rawFilters = {
        ...(query.filter ? (typeof query.filter === "object" ? query.filter : {}) : {}),
        ...(query.filters ? (typeof query.filters === "object" ? query.filters : {}) : {}),
      };

      const hasFilters = Object.keys(rawFilters).length > 0;
      const fieldFilters = hasFilters
        ? Object.fromEntries(
            Object.entries(rawFilters).map(([key, raw]) => {
              if (typeof raw === "string") {
                if (raw === "true") return [key, true];
                if (raw === "false") return [key, false];
                const n = Number(raw);
                if (raw !== "" && !Number.isNaN(n)) return [key, n];
              }
              return [key, raw];
            }),
          )
        : undefined;

      const result = await repository.getDatasetRows(query.workspaceId, params.id, query.userId, {
        page: query.page,
        limit: query.limit,
        sort: query.sort,
        order: query.order as SortOrder,
        ...(query.search !== undefined ? { search: query.search } : {}),
        ...(query.validOnly !== undefined ? { validOnly: query.validOnly } : {}),
        ...(query.duplicatesOnly !== undefined ? { duplicatesOnly: query.duplicatesOnly } : {}),
        ...(query.verificationStatus !== undefined ? { verificationStatus: query.verificationStatus } : {}),
        ...(query.confidenceMin !== undefined ? { confidenceMin: query.confidenceMin } : {}),
        ...(query.confidenceMax !== undefined ? { confidenceMax: query.confidenceMax } : {}),
        ...(query.sourceId !== undefined ? { sourceId: query.sourceId } : {}),
        ...(fieldFilters !== undefined ? { fieldFilters } : {}),
      });

      const formattedRows = result.data.map((r: any) => {
        const confNum = typeof r.confidence === "number"
          ? (r.confidence <= 1.0 ? Math.round(r.confidence * 100) : Math.round(r.confidence))
          : 90;
        return {
          ...r,
          data: r.values ?? r.data ?? {},
          values: r.values ?? r.data ?? {},
          confidence: confNum,
          isValid: r.isValid ?? true,
          verificationStatus: r.verificationStatus,
          collectedAt: r.collectedAt ? new Date(r.collectedAt).toISOString() : new Date().toISOString(),
          sourceIds: r.sourceIds ?? Array.from({ length: r.sourceEvidenceCount ?? 1 }, (_, i) => `src-${i + 1}`),
          sourceEvidenceCount: r.sourceEvidenceCount ?? 0,
        };
      });

      res.json({
        ...result,
        data: formattedRows,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
      });
    },
  );

  // GET /datasets/:id/rows/:rowId  — evidence and provenance
  router.get(
    "/datasets/:id/rows/:rowId",
    validateRequest({ params: RowIdParams, query: DatasetAccessQuery }),
    async (_req, res) => {
      const { params, query } = res.locals.validated as {
        params: z.infer<typeof RowIdParams>;
        query: z.infer<typeof DatasetAccessQuery>;
      };
      res.json(
        await repository.getRowEvidence(query.workspaceId, params.id, params.rowId, query.userId),
      );
    },
  );

  // GET /datasets/:id/rows/:rowId/evidence  — provenance alias
  router.get(
    "/datasets/:id/rows/:rowId/evidence",
    validateRequest({ params: RowIdParams, query: DatasetAccessQuery }),
    async (_req, res) => {
      const { params, query } = res.locals.validated as {
        params: z.infer<typeof RowIdParams>;
        query: z.infer<typeof DatasetAccessQuery>;
      };
      res.json(
        await repository.getRowEvidence(query.workspaceId, params.id, params.rowId, query.userId),
      );
    },
  );

  // GET /rows/:id/evidence  — Phase 10 Source and Evidence Explorer
  router.get(
    "/rows/:id/evidence",
    validateRequest({ params: UUIDParam, query: DatasetAccessQuery }),
    async (_req, res) => {
      const { params, query } = res.locals.validated as {
        params: z.infer<typeof UUIDParam>;
        query: z.infer<typeof DatasetAccessQuery>;
      };
      res.json(await repository.getRowEvidence(query.workspaceId, params.id, query.userId));
    },
  );

  // GET /datasets/:id/sources
  router.get(
    "/datasets/:id/sources",
    validateRequest({ params: UUIDParam, query: DatasetSourcesQuery }),
    async (_req, res) => {
      const { params, query } = res.locals.validated as {
        params: z.infer<typeof UUIDParam>;
        query: z.infer<typeof DatasetSourcesQuery>;
      };
      const result = await repository.getDatasetSources(
        query.workspaceId,
        params.id,
        query.userId,
        { page: query.page, limit: query.limit },
        query.order as SortOrder,
        query.search,
      );
      res.json(result);
    },
  );

  // GET /sources/:id  — source inspection
  router.get(
    "/sources/:id",
    validateRequest({ params: UUIDParam, query: DatasetAccessQuery }),
    async (_req, res) => {
      const { params, query } = res.locals.validated as {
        params: z.infer<typeof UUIDParam>;
        query: z.infer<typeof DatasetAccessQuery>;
      };
      res.json(await repository.getSource(query.workspaceId, params.id, query.userId));
    },
  );

  return router;
}
