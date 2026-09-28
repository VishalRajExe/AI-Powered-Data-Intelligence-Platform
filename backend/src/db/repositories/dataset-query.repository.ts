import type { PrismaClient, Prisma } from "@prisma/client";
import { AppError } from "../../common/errors.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface PaginationInput {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type SortOrder = "asc" | "desc";

export interface RowQueryInput extends PaginationInput {
  search?: string;
  validOnly?: boolean;
  duplicatesOnly?: boolean;
  verificationStatus?: "SOURCE_CITED_UNVERIFIED" | "UNSUPPORTED" | "CONFLICTED";
  confidenceMin?: number;
  confidenceMax?: number;
  sort?: "createdAt" | "confidence" | "collectedAt";
  order?: SortOrder;
  fieldFilters?: Record<string, string | number | boolean>;
  sourceId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pageArgs(p: PaginationInput): { skip: number; take: number } {
  const take = Math.max(1, Math.min(p.limit, 200));
  const skip = (Math.max(1, p.page) - 1) * take;
  return { skip, take };
}

function paginated<T>(data: T[], total: number, p: PaginationInput): PaginatedResult<T> {
  const limit = Math.max(1, Math.min(p.limit, 200));
  return { data, total, page: p.page, limit, totalPages: Math.ceil(total / limit) || 1 };
}

/**
 * Column key validation: only alphanumeric + underscore + hyphen allowed.
 * This prevents a user-supplied key from escaping a MySQL JSON path expression.
 */
function isValidColumnKey(key: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(key);
}

// ---------------------------------------------------------------------------
// DatasetQueryRepository — workspace-scoped, read-only queries
// ---------------------------------------------------------------------------

export class DatasetQueryRepository {
  constructor(private readonly prisma: PrismaClient) {}

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

  // ── GET /datasets ─────────────────────────────────────────────────────────

  async listDatasets(
    workspaceId: string,
    userId: string,
    pagination: PaginationInput,
    sort: "createdAt" | "updatedAt" | "recordCount" = "updatedAt",
    order: SortOrder = "desc",
    search?: string,
  ): Promise<PaginatedResult<object>> {
    await this.assertAccess(workspaceId, userId);
    const { skip, take } = pageArgs(pagination);

    const where: Prisma.DatasetWhereInput = {
      workspaceId,
      ...(search && search.trim()
        ? {
            OR: [
              { name: { contains: search.trim() } },
              { description: { contains: search.trim() } },
              { run: { workflow: { requirement: { contains: search.trim() } } } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.dataset.count({ where }),
      this.prisma.dataset.findMany({
        where,
        orderBy: { [sort]: order },
        skip,
        take,
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          recordCount: true,
          validCount: true,
          duplicateCount: true,
          sourceCount: true,
          createdAt: true,
          updatedAt: true,
          columns: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              key: true,
              label: true,
              type: true,
              position: true,
              required: true,
              filterable: true,
              sortable: true,
            },
          },
          run: {
            select: {
              id: true,
              workflowId: true,
              status: true,
              startedAt: true,
              finishedAt: true,
              workflow: { select: { requirement: true } },
            },
          },
          dataQualityReport: {
            take: 1,
            select: { qualityScore: true, metrics: true, computedAt: true },
          },
        },
      }),
    ]);

    const data = rows.map((row) => {
      const report = row.dataQualityReport[0] ?? null;
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        status: row.status,
        recordCount: row.recordCount,
        validCount: row.validCount,
        duplicateCount: row.duplicateCount,
        sourceCount: row.sourceCount,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        workflowId: row.run?.workflowId ?? null,
        runId: row.run?.id ?? null,
        runStatus: row.run?.status ?? null,
        originalPrompt: row.run?.workflow?.requirement ?? null,
        qualityScore: report?.qualityScore ?? null,
        qualityMetrics: report?.metrics ?? null,
        columns: (row.columns ?? []).map((col) => ({
          id: col.id,
          key: col.key,
          label: col.label,
          type: col.type,
          position: col.position,
          required: col.required,
          filterable: col.filterable,
          sortable: col.sortable,
        })),
      };
    });

    return paginated(data, total, pagination);
  }

  // ── GET /datasets/:id ─────────────────────────────────────────────────────

  async getDataset(workspaceId: string, datasetId: string, userId: string): Promise<object> {
    await this.assertAccess(workspaceId, userId);

    const ds = await this.prisma.dataset.findFirst({
      where: { workspaceId, id: datasetId },
      include: {
        columns: { orderBy: { position: "asc" } },
        run: {
          select: {
            id: true,
            workflowId: true,
            status: true,
            attempt: true,
            startedAt: true,
            finishedAt: true,
            workflow: { select: { id: true, requirement: true, name: true } },
          },
        },
        dataQualityReport: {
          take: 1,
          select: {
            qualityScore: true,
            rawRecordCount: true,
            normalizedRecordCount: true,
            validRecordCount: true,
            invalidRecordCount: true,
            duplicateCount: true,
            reviewRequiredCount: true,
            conflictCount: true,
            sourceBackedCount: true,
            metrics: true,
            computedAt: true,
          },
        },
      },
    });

    if (!ds) throw new AppError("Dataset not found", 404, "DATASET_NOT_FOUND");

    const report = ds.dataQualityReport[0] ?? null;
    return {
      id: ds.id,
      name: ds.name,
      description: ds.description,
      status: ds.status,
      recordCount: ds.recordCount,
      validCount: ds.validCount,
      duplicateCount: ds.duplicateCount,
      sourceCount: ds.sourceCount,
      createdAt: ds.createdAt,
      updatedAt: ds.updatedAt,
      workflowId: ds.run?.workflowId ?? null,
      runId: ds.run?.id ?? null,
      originalPrompt: ds.run?.workflow?.requirement ?? null,
      workflowName: ds.run?.workflow?.name ?? null,
      columns: ds.columns.map((col) => ({
        id: col.id,
        key: col.key,
        label: col.label,
        type: col.type,
        position: col.position,
        required: col.required,
        filterable: col.filterable,
        sortable: col.sortable,
      })),
      qualityReport: report
        ? {
            qualityScore: report.qualityScore,
            rawRecordCount: report.rawRecordCount,
            validRecordCount: report.validRecordCount,
            invalidRecordCount: report.invalidRecordCount,
            duplicateCount: report.duplicateCount,
            reviewRequiredCount: report.reviewRequiredCount,
            conflictCount: report.conflictCount,
            sourceBackedCount: report.sourceBackedCount,
            metrics: report.metrics,
            computedAt: report.computedAt,
          }
        : null,
    };
  }

  // ── GET /datasets/:id/schema ──────────────────────────────────────────────

  async getDatasetSchema(workspaceId: string, datasetId: string, userId: string): Promise<object> {
    await this.assertAccess(workspaceId, userId);

    const ds = await this.prisma.dataset.findFirst({
      where: { workspaceId, id: datasetId },
      select: {
        id: true,
        name: true,
        status: true,
        columns: { orderBy: { position: "asc" } },
      },
    });

    if (!ds) throw new AppError("Dataset not found", 404, "DATASET_NOT_FOUND");

    return {
      datasetId: ds.id,
      name: ds.name,
      status: ds.status,
      columns: ds.columns.map((col) => ({
        key: col.key,
        label: col.label,
        type: col.type,
        position: col.position,
        required: col.required,
        filterable: col.filterable,
        sortable: col.sortable,
      })),
    };
  }

  // ── GET /datasets/:id/rows ────────────────────────────────────────────────

  async getDatasetRows(
    workspaceId: string,
    datasetId: string,
    userId: string,
    query: RowQueryInput,
  ): Promise<PaginatedResult<object>> {
    await this.assertAccess(workspaceId, userId);

    // Verify dataset belongs to workspace and collect registered column keys
    const ds = await this.prisma.dataset.findFirst({
      where: { workspaceId, id: datasetId },
      select: { id: true, columns: { select: { key: true, filterable: true } } },
    });
    if (!ds) throw new AppError("Dataset not found", 404, "DATASET_NOT_FOUND");

    // Validate field filter keys against registered schema — prevent injection
    const filterableKeys = new Set(
      ds.columns.filter((c) => c.filterable).map((c) => c.key),
    );
    if (query.fieldFilters) {
      for (const key of Object.keys(query.fieldFilters)) {
        if (!isValidColumnKey(key)) {
          throw new AppError(`Invalid filter key format: '${key}'`, 400, "INVALID_FILTER_KEY");
        }
        if (!filterableKeys.has(key)) {
          throw new AppError(
            `'${key}' is not a registered filterable column`,
            400,
            "INVALID_FILTER_KEY",
          );
        }
      }
    }

    const { skip, take } = pageArgs(query);
    const sortField = query.sort === "confidence" ? "confidence" : query.sort === "collectedAt" ? "collectedAt" : "createdAt";
    const order = query.order ?? "desc";

    // Build Prisma WHERE — typed via Prisma.DatasetRowWhereInput, no raw interpolation
    const where: Prisma.DatasetRowWhereInput = {
      workspaceId,
      datasetId,
      ...(query.validOnly ? { isValid: true } : {}),
      ...(query.duplicatesOnly ? { duplicateOfId: { not: null } } : {}),
      ...(query.verificationStatus ? { verificationStatus: query.verificationStatus } : {}),
      ...(query.confidenceMin !== undefined || query.confidenceMax !== undefined
        ? {
            confidence: {
              ...(query.confidenceMin !== undefined ? { gte: query.confidenceMin } : {}),
              ...(query.confidenceMax !== undefined ? { lte: query.confidenceMax } : {}),
            },
          }
        : {}),
      ...(query.sourceId
        ? { sourceEvidence: { some: { sourceId: query.sourceId, workspaceId } } }
        : {}),
    };

    // Collect row-ID sets for search and field filters (safe raw queries)
    const idConstraints: string[][] = [];

    if (query.search && query.search.trim()) {
      const ids = await this.rowIdsBySearch(workspaceId, datasetId, query.search.trim());
      if (ids.length === 0) return paginated([], 0, query);
      idConstraints.push(ids);
    }

    if (query.fieldFilters && Object.keys(query.fieldFilters).length > 0) {
      const ids = await this.rowIdsByFieldFilters(workspaceId, datasetId, query.fieldFilters);
      if (ids.length === 0) return paginated([], 0, query);
      idConstraints.push(ids);
    }

    if (idConstraints.length > 0) {
      // Intersect all ID sets using explicit typed loop
      const sets = idConstraints.map((arr) => new Set(arr));
      let intersection = sets[0] ?? new Set<string>();
      for (let i = 1; i < sets.length; i++) {
        const s = sets[i]!;
        const r = new Set<string>();
        for (const id of intersection) if (s.has(id)) r.add(id);
        intersection = r;
      }
      if (intersection.size === 0) return paginated([], 0, query);
      // Cast to any to avoid deep Prisma where-type mismatch on id
      (where as Record<string, unknown>)["id"] = { in: [...intersection] };
    }

    const [total, rows] = await Promise.all([
      this.prisma.datasetRow.count({ where }),
      this.prisma.datasetRow.findMany({
        where,
        orderBy: { [sortField]: order },
        skip,
        take,
        select: {
          id: true,
          values: true,
          confidence: true,
          isValid: true,
          verificationStatus: true,
          duplicateOfId: true,
          collectedAt: true,
          createdAt: true,
          _count: { select: { sourceEvidence: true } },
        },
      }),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.id,
        values: row.values,
        confidence: row.confidence,
        isValid: row.isValid,
        verificationStatus: row.verificationStatus,
        duplicateOfId: row.duplicateOfId,
        collectedAt: row.collectedAt,
        createdAt: row.createdAt,
        sourceEvidenceCount: row._count.sourceEvidence,
      })),
      total,
      query,
    );
  }

  // ── GET /datasets/:id/rows/:rowId ─────────────────────────────────────────

  async getRowEvidence(
    workspaceId: string,
    datasetId: string,
    rowId: string,
    userId: string,
  ): Promise<object> {
    await this.assertAccess(workspaceId, userId);

    const row = await this.prisma.datasetRow.findFirst({
      where: { workspaceId, datasetId, id: rowId },
      select: {
        id: true,
        values: true,
        rawValues: true,
        confidence: true,
        isValid: true,
        verificationStatus: true,
        qualityMetadata: true,
        duplicateOfId: true,
        collectedAt: true,
        createdAt: true,
        validationIssues: {
          select: {
            fieldKey: true,
            ruleCode: true,
            severity: true,
            message: true,
            expected: true,
            actual: true,
            createdAt: true,
          },
          orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
        },
        sourceEvidence: {
          select: {
            id: true,
            fieldKey: true,
            evidenceType: true,
            snippet: true,
            confidence: true,
            retrievedAt: true,
            source: {
              select: {
                id: true,
                url: true,
                canonicalUrl: true,
                domain: true,
                title: true,
                status: true,
                policyReason: true,
                robotsStatus: true,
                attemptCount: true,
                retrievedAt: true,
                sourceMetadata: true,
              },
            },
            column: { select: { key: true, label: true, type: true } },
          },
          orderBy: { retrievedAt: "asc" },
        },
      },
    });

    if (!row) throw new AppError("Dataset row not found", 404, "DATASET_ROW_NOT_FOUND");

    return {
      rowId: row.id,
      values: row.values,
      rawValues: row.rawValues,
      confidence: row.confidence,
      isValid: row.isValid,
      verificationStatus: row.verificationStatus,
      qualityMetadata: row.qualityMetadata,
      duplicateOfId: row.duplicateOfId,
      collectedAt: row.collectedAt,
      createdAt: row.createdAt,
      validationIssues: row.validationIssues,
      evidence: row.sourceEvidence.map((ev) => ({
        id: ev.id,
        fieldKey: ev.fieldKey,
        column: ev.column,
        evidenceType: ev.evidenceType,
        snippet: ev.snippet,
        confidence: ev.confidence,
        retrievedAt: ev.retrievedAt,
        source: ev.source,
      })),
    };
  }

  // ── GET /datasets/:id/sources ─────────────────────────────────────────────

  async getDatasetSources(
    workspaceId: string,
    datasetId: string,
    userId: string,
    pagination: PaginationInput,
    order: SortOrder = "desc",
    search?: string,
  ): Promise<PaginatedResult<object>> {
    await this.assertAccess(workspaceId, userId);

    const ds = await this.prisma.dataset.findFirst({
      where: { workspaceId, id: datasetId },
      select: { workflowRunId: true },
    });
    if (!ds) throw new AppError("Dataset not found", 404, "DATASET_NOT_FOUND");

    const { skip, take } = pageArgs(pagination);

    const where: Prisma.SourceWhereInput = {
      workspaceId,
      workflowRunId: ds.workflowRunId,
      ...(search && search.trim()
        ? {
            OR: [
              { url: { contains: search.trim() } },
              { canonicalUrl: { contains: search.trim() } },
              { domain: { contains: search.trim() } },
              { title: { contains: search.trim() } },
            ],
          }
        : {}),
    };

    const [total, sources] = await Promise.all([
      this.prisma.source.count({ where }),
      this.prisma.source.findMany({
        where,
        orderBy: { retrievedAt: order },
        skip,
        take,
        select: {
          id: true,
          url: true,
          canonicalUrl: true,
          domain: true,
          title: true,
          status: true,
          policyReason: true,
          robotsStatus: true,
          robotsCheckedAt: true,
          attemptCount: true,
          lastAttemptAt: true,
          retrievedAt: true,
          errorCode: true,
          errorMessage: true,
          sourceMetadata: true,
          createdAt: true,
          _count: { select: { evidence: true } },
        },
      }),
    ]);

    return paginated(
      sources.map((src) => ({
        id: src.id,
        url: src.url,
        canonicalUrl: src.canonicalUrl,
        domain: src.domain,
        title: src.title,
        status: src.status,
        policyReason: src.policyReason,
        robotsStatus: src.robotsStatus,
        robotsCheckedAt: src.robotsCheckedAt,
        attemptCount: src.attemptCount,
        lastAttemptAt: src.lastAttemptAt,
        retrievedAt: src.retrievedAt,
        errorCode: src.errorCode,
        errorMessage: src.errorMessage,
        sourceMetadata: src.sourceMetadata,
        createdAt: src.createdAt,
        evidenceCount: src._count.evidence,
      })),
      total,
      pagination,
    );
  }

  // ── GET /sources/:id ──────────────────────────────────────────────────────

  async getSource(workspaceId: string, sourceId: string, userId: string): Promise<object> {
    await this.assertAccess(workspaceId, userId);

    const source = await this.prisma.source.findFirst({
      where: { workspaceId, id: sourceId },
      include: {
        evidence: {
          take: 50,
          select: {
            id: true,
            datasetId: true,
            datasetRowId: true,
            fieldKey: true,
            evidenceType: true,
            snippet: true,
            confidence: true,
            retrievedAt: true,
          },
        },
      },
    });

    if (!source) throw new AppError("Source not found", 404, "SOURCE_NOT_FOUND");

    return {
      id: source.id,
      workspaceId: source.workspaceId,
      workflowRunId: source.workflowRunId,
      datasetId: source.datasetId,
      url: source.url,
      canonicalUrl: source.canonicalUrl,
      domain: source.domain,
      title: source.title,
      status: source.status,
      policyReason: source.policyReason,
      robotsStatus: source.robotsStatus,
      robotsCheckedAt: source.robotsCheckedAt,
      attemptCount: source.attemptCount,
      lastAttemptAt: source.lastAttemptAt,
      retrievedAt: source.retrievedAt,
      errorCode: source.errorCode,
      errorMessage: source.errorMessage,
      sourceMetadata: source.sourceMetadata,
      createdAt: source.createdAt,
      evidence: source.evidence,
    };
  }

  // ── Private: safe parameterised raw queries ───────────────────────────────

  /**
   * Full-text search over the JSON `values` column using LIKE.
   * The pattern is bound as a parameterised value — never string-interpolated
   * into the SQL template. MySQL special LIKE characters (%, _, \) are escaped.
   */
  private async rowIdsBySearch(
    workspaceId: string,
    datasetId: string,
    search: string,
  ): Promise<string[]> {
    const pattern = `%${search.replace(/[%_\\]/g, "\\$&")}%`;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM   dataset_rows
      WHERE  workspace_id = ${workspaceId}
        AND  dataset_id   = ${datasetId}
        AND  CAST(\`values\` AS CHAR) LIKE ${pattern} ESCAPE '\\'
      LIMIT  5000
    `;
    return rows.map((r) => r.id);
  }

  /**
   * Schema-aware field filter using MySQL JSON_EXTRACT.
   * Column keys are pre-validated as safe identifiers before this method is
   * called. Values are bound as parameters — no concatenation.
   */
  private async rowIdsByFieldFilters(
    workspaceId: string,
    datasetId: string,
    fieldFilters: Record<string, string | number | boolean>,
  ): Promise<string[]> {
    const sets: Set<string>[] = [];

    for (const [key, value] of Object.entries(fieldFilters)) {
      // Safety: key already validated by caller; double-check here
      if (!isValidColumnKey(key)) continue;

      const jsonPath = `$.${key}`;
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM   dataset_rows
        WHERE  workspace_id = ${workspaceId}
          AND  dataset_id   = ${datasetId}
          AND  JSON_EXTRACT(\`values\`, ${jsonPath}) = ${value}
        LIMIT  5000
      `;
      sets.push(new Set(rows.map((r) => r.id)));
    }

    if (sets.length === 0) return [];
    let intersection = sets[0] ?? new Set<string>();
    for (let i = 1; i < sets.length; i++) {
      const s = sets[i]!;
      const out = new Set<string>();
      for (const id of intersection) if (s.has(id)) out.add(id);
      intersection = out;
    }
    return [...intersection];
  }
}
