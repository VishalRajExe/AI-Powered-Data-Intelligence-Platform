import { EventEmitter } from "node:events";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { RunActivityEvent, ActivityAction } from "./monitoring.types.js";

export interface RecordEventInput {
  workspaceId: string;
  actorId?: string | null;
  action: ActivityAction;
  entityType: "workflow" | "workflow_run" | "dataset" | string;
  entityId: string;
  details?: Record<string, unknown> | null;
}

export class WorkflowEventBroadcaster {
  private readonly localEmitter = new EventEmitter();
  private isRedisSubscribed = false;
  private readonly channelPrefix = "aidp:run:";
  private readonly redisPublisher?: Redis | undefined;
  private readonly redisSubscriber?: Redis | undefined;

  constructor(
    private readonly prisma: PrismaClient,
    options?: {
      redisPublisher?: Redis | undefined;
      redisSubscriber?: Redis | undefined;
      logger?: Logger | undefined;
    } | undefined,
  ) {
    this.localEmitter.setMaxListeners(200);
    this.redisPublisher = options?.redisPublisher;
    this.redisSubscriber = options?.redisSubscriber;

    if (this.redisSubscriber) {
      this.setupRedisSubscriber();
    }
  }

  private setupRedisSubscriber(): void {
    if (!this.redisSubscriber) return;

    this.redisSubscriber.on("message", (channel: string, message: string) => {
      try {
        if (!channel.startsWith(this.channelPrefix)) return;
        const parsed = JSON.parse(message) as RunActivityEvent;
        const entityId = channel.slice(this.channelPrefix.length, -":events".length);
        // Dispatch to local listeners for cross-process delivery
        this.localEmitter.emit(`redis:${entityId}`, parsed);
      } catch {
        // Ignore unparseable messages
      }
    });
  }

  /**
   * Persists an activity event to MySQL and broadcasts it to local and cross-process listeners.
   * Ensures history is NEVER kept only in memory.
   */
  async recordAndBroadcast(input: RecordEventInput): Promise<RunActivityEvent> {
    const created = await this.prisma.activityEvent.create({
      data: {
        workspaceId: input.workspaceId,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        ...(input.details !== undefined && input.details !== null
          ? { details: JSON.parse(JSON.stringify(input.details)) as Prisma.InputJsonValue }
          : {}),
      },
    });

    const event: RunActivityEvent = {
      id: created.id,
      workspaceId: created.workspaceId,
      actorId: created.actorId,
      action: created.action,
      entityType: created.entityType,
      entityId: created.entityId,
      details: (created.details as Record<string, unknown> | null) ?? null,
      createdAt: created.createdAt.toISOString(),
    };

    // 1. Broadcast locally
    this.localEmitter.emit(`local:${input.entityId}`, event);

    // 2. Broadcast across processes via Redis Pub/Sub
    if (this.redisPublisher && ["ready", "connect"].includes(this.redisPublisher.status)) {
      try {
        const channel = `${this.channelPrefix}${input.entityId}:events`;
        await this.redisPublisher.publish(channel, JSON.stringify(event));
      } catch {
        // Non-blocking: database persistence is authoritative
      }
    }

    return event;
  }

  /**
   * Retrieves durable activity events from MySQL.
   */
  async getHistory(workspaceId: string, entityId: string, afterId?: string): Promise<RunActivityEvent[]> {
    const records = await this.prisma.activityEvent.findMany({
      where: {
        workspaceId,
        entityId,
      },
      orderBy: { createdAt: "asc" },
      take: 500,
    });

    let foundAfter = !afterId;
    const result: RunActivityEvent[] = [];

    for (const r of records) {
      if (!foundAfter) {
        if (r.id === afterId) {
          foundAfter = true;
        }
        continue;
      }
      result.push({
        id: r.id,
        workspaceId: r.workspaceId,
        actorId: r.actorId,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        details: (r.details as Record<string, unknown> | null) ?? null,
        createdAt: r.createdAt.toISOString(),
      });
    }

    return result;
  }

  /**
   * Subscribes to live events for a run.
   * Uses deduplication so events delivered through both local and Redis are dispatched once.
   */
  async subscribe(
    entityId: string,
    listener: (event: RunActivityEvent) => void,
  ): Promise<() => Promise<void>> {
    const seenEventIds = new Set<string>();

    const safeDispatch = (event: RunActivityEvent) => {
      if (seenEventIds.has(event.id)) return;
      seenEventIds.add(event.id);
      // Bound the deduplication set size
      if (seenEventIds.size > 1000) {
        const first = seenEventIds.values().next().value;
        if (first) seenEventIds.delete(first);
      }
      listener(event);
    };

    const localChannel = `local:${entityId}`;
    const redisChannelName = `redis:${entityId}`;
    const pubSubChannel = `${this.channelPrefix}${entityId}:events`;

    this.localEmitter.on(localChannel, safeDispatch);
    this.localEmitter.on(redisChannelName, safeDispatch);

    if (this.redisSubscriber && ["ready", "connect"].includes(this.redisSubscriber.status)) {
      try {
        await this.redisSubscriber.subscribe(pubSubChannel);
      } catch {
        // Fallback to local emitter
      }
    }

    return async () => {
      this.localEmitter.off(localChannel, safeDispatch);
      this.localEmitter.off(redisChannelName, safeDispatch);

      if (this.redisSubscriber && ["ready", "connect"].includes(this.redisSubscriber.status)) {
        try {
          await this.redisSubscriber.unsubscribe(pubSubChannel);
        } catch {
          // Ignore unsubscribe cleanup errors
        }
      }
    };
  }
}
