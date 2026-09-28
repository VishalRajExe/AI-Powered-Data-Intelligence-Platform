import type { PrismaClient, SourceStatus } from "@prisma/client";
import type { SourceLifecycleInput, SourceLifecycleStore, SourceLifecycleUpdate } from "../../modules/sources/source-governance.types.js";

export class WorkflowSourceRepository implements SourceLifecycleStore {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertDiscovered(input: SourceLifecycleInput): Promise<{ id: string }> {
    const data = {
      url: input.url,
      canonicalUrl: input.canonicalUrl,
      domain: input.domain,
      ...(input.title ? { title: input.title.slice(0, 512) } : {}),
      ...(input.metadata ? { sourceMetadata: input.metadata as never } : {}),
    };
    return this.prisma.source.upsert({
      where: { workflowRunId_canonicalUrlHash: { workflowRunId: input.workflowRunId, canonicalUrlHash: input.canonicalUrlHash } },
      create: {
        workspaceId: input.workspaceId,
        workflowRunId: input.workflowRunId,
        status: "DISCOVERED",
        ...data,
        canonicalUrlHash: input.canonicalUrlHash,
      },
      update: data,
      select: { id: true },
    });
  }

  async updateLifecycle(workspaceId: string, workflowRunId: string, canonicalUrlHash: string, update: SourceLifecycleUpdate): Promise<void> {
    const { status, code, reason, robotsStatus, robotsCheckedAt, attemptCount, attemptedAt, retrievedAt, title, metadata } = update;
    await this.prisma.source.update({
      where: { workflowRunId_canonicalUrlHash: { workflowRunId, canonicalUrlHash } },
      data: {
        status: status as SourceStatus,
        errorCode: code ?? null,
        errorMessage: reason ?? null,
        policyReason: reason ?? null,
        ...(robotsStatus !== undefined ? { robotsStatus } : {}),
        ...(robotsCheckedAt !== undefined ? { robotsCheckedAt } : {}),
        ...(attemptCount !== undefined ? { attemptCount } : {}),
        ...(attemptedAt ? { lastAttemptAt: attemptedAt } : {}),
        ...(retrievedAt ? { retrievedAt } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(metadata !== undefined ? { sourceMetadata: metadata as never } : {}),
      },
    });
  }
}
