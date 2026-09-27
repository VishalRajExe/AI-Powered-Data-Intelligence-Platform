import { SourceStatus, type Prisma, type PrismaClient } from "@prisma/client";

export interface EvidenceInput {
  sourceId: string;
  datasetColumnId?: string;
  fieldKey?: string;
  snippet?: string;
  valueHash?: string;
  confidence?: number;
  retrievedAt: Date;
}

export interface InsertDatasetRowInput {
  workspaceId: string;
  datasetId: string;
  values: Prisma.InputJsonValue;
  confidence?: number;
  isValid?: boolean;
  collectedAt?: Date;
  evidence: EvidenceInput[];
}

/** Persists a row and its provenance atomically; rows without evidence are rejected. */
export class DatasetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async insertRowWithEvidence(input: InsertDatasetRowInput) {
    if (input.evidence.length === 0) {
      throw new Error("A dataset row must include at least one source evidence record");
    }

    const sourceIds = [...new Set(input.evidence.map(({ sourceId }) => sourceId))];

    return this.prisma.$transaction(async (transaction) => {
      const dataset = await transaction.dataset.findUnique({
        where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.datasetId } },
        select: { workflowRunId: true },
      });
      if (!dataset) throw new Error("Dataset was not found in the requested workspace");

      const validSources = await transaction.source.findMany({
        where: {
          id: { in: sourceIds },
          workspaceId: input.workspaceId,
          workflowRunId: dataset.workflowRunId,
          status: SourceStatus.FETCHED,
        },
        select: { id: true },
      });
      const validSourceIds = new Set(validSources.map(({ id }) => id));
      if (sourceIds.some((sourceId) => !validSourceIds.has(sourceId))) {
        throw new Error("Every dataset row evidence source must be fetched in the dataset workflow run");
      }

      const isValid = input.isValid ?? true;
      const row = await transaction.datasetRow.create({
        data: {
          workspaceId: input.workspaceId,
          datasetId: input.datasetId,
          values: input.values,
          ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
          isValid,
          ...(input.collectedAt === undefined ? {} : { collectedAt: input.collectedAt }),
        },
      });

      await transaction.sourceEvidence.createMany({
        data: input.evidence.map((item) => ({
          workspaceId: input.workspaceId,
          datasetId: input.datasetId,
          datasetRowId: row.id,
          sourceId: item.sourceId,
          datasetColumnId: item.datasetColumnId ?? null,
          fieldKey: item.fieldKey ?? null,
          snippet: item.snippet ?? null,
          valueHash: item.valueHash ?? null,
          confidence: item.confidence ?? null,
          retrievedAt: item.retrievedAt,
        })),
      });

      await transaction.dataset.update({
        where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.datasetId } },
        data: {
          recordCount: { increment: 1 },
          ...(isValid ? { validCount: { increment: 1 } } : {}),
        },
      });

      return transaction.datasetRow.findUniqueOrThrow({
        where: { id: row.id },
        include: { sourceEvidence: { include: { source: true, column: true } } },
      });
    });
  }
}
