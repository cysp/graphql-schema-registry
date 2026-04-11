import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import {
  requireAuthenticatedUser,
  requireGraphReadGrant,
} from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { selectActiveGraphBySlug } from "../database/graphs/repository.ts";
import { selectCurrentSupergraphSchemaRevision } from "../database/supergraph-schemas/repository.ts";
import {
  etagSatisfiesIfNoneMatch,
  formatStrongETag,
  parseIfMatchHeader,
  parseIfNoneMatchHeader,
} from "../etag.ts";
import {
  decodeSupergraphSchemaUpdatedNotification,
  supergraphSchemaUpdatesChannel,
} from "../supergraph-schema-updates.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

function acceptsServerSentEvents(acceptHeader: string | string[] | undefined): boolean {
  if (acceptHeader === undefined) {
    return false;
  }

  const headerValues = typeof acceptHeader === "string" ? [acceptHeader] : acceptHeader;

  for (const headerValue of headerValues) {
    for (const mediaRange of headerValue.split(",")) {
      const mediaType = mediaRange.split(";")[0]?.trim().toLowerCase();
      if (mediaType === "text/event-stream") {
        return true;
      }
    }
  }

  return false;
}

function parseLastEventIdHeader(value: string | string[] | undefined): string | undefined {
  const condition = parseIfMatchHeader(value);
  if (condition === undefined) {
    return undefined;
  }

  if (condition.kind === "wildcard" || condition.entityTags.length !== 1) {
    throw new Error("Last-Event-ID must be a single entity-tag value.");
  }

  return condition.entityTags[0];
}

function writeSseEvent(response: NodeJS.WritableStream, eventId: string, sdl: string): void {
  response.write(`id: ${eventId}\n`);
  for (const line of sdl.split(/\r?\n/u)) {
    response.write(`data: ${line}\n`);
  }
  response.write("\n");
}

export const getSupergraphSchemaHandler: DependencyInjectedHandler<
  OperationHandlers["getSupergraphSchema"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  if (!requireAuthenticatedUser(request, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const graph = await selectActiveGraphBySlug(database, request.params.graphSlug);
  if (!graph) {
    return reply.problemDetails({ status: 404 });
  }

  if (!requireGraphReadGrant(request, reply, graph.id)) {
    return;
  }

  const sseRequested = acceptsServerSentEvents(request.headers.accept);

  if (sseRequested) {
    let lastEventId: string | undefined;
    try {
      lastEventId = parseLastEventIdHeader(request.headers["last-event-id"]);
    } catch {
      return reply.problemDetails({ status: 400 });
    }

    let closed = false;
    let isPolling = false;
    let pollQueued = false;
    let listenMeta: Awaited<ReturnType<PostgresJsDatabase["$client"]["listen"]>> | undefined;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    let lastSentEtag = lastEventId;

    const teardown = async (): Promise<void> => {
      if (closed) {
        return;
      }

      closed = true;

      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }

      if (listenMeta) {
        try {
          await listenMeta.unlisten();
        } catch (error) {
          request.log.warn({ error }, "failed to unlisten supergraph schema updates");
        }
      }
    };

    const pollAndEmitLatest = async (): Promise<void> => {
      const currentSupergraphSchema = await selectCurrentSupergraphSchemaRevision(database, graph.id);
      if (!currentSupergraphSchema) {
        return;
      }

      const currentEtag = formatStrongETag(
        currentSupergraphSchema.graphId,
        currentSupergraphSchema.compositionRevision,
      );

      if (currentEtag === lastSentEtag || closed) {
        return;
      }

      writeSseEvent(reply.raw, currentEtag, currentSupergraphSchema.supergraphSdl);
      lastSentEtag = currentEtag;
    };

    const queuePoll = async (): Promise<void> => {
      if (closed) {
        return;
      }

      if (isPolling) {
        pollQueued = true;
        return;
      }

      isPolling = true;
      try {
        await pollAndEmitLatest();
      } catch (error) {
        request.log.warn({ error }, "failed to publish supergraph schema SSE update");
        await teardown();
        if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
        return;
      } finally {
        isPolling = false;
      }

      if (pollQueued) {
        pollQueued = false;
        await queuePoll();
      }
    };

    try {
      listenMeta = await database.$client.listen(supergraphSchemaUpdatesChannel, (payload) => {
        const notification = decodeSupergraphSchemaUpdatedNotification(payload);
        if (!notification || notification.graphId !== graph.id) {
          return;
        }

        // oxlint-disable-next-line eslint(no-void)
        void queuePoll();
      });
    } catch (error) {
      request.log.warn({ error }, "failed to listen for supergraph schema updates");
      return reply.problemDetails({ status: 503 });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    });

    request.raw.once("close", () => {
      // oxlint-disable-next-line eslint(no-void)
      void teardown();
    });

    heartbeatTimer = setInterval(() => {
      if (closed || reply.raw.writableEnded) {
        return;
      }

      reply.raw.write(": heartbeat\n\n");
    }, 25_000);

    await queuePoll();
    return;
  }

  const ifNoneMatch = parseIfNoneMatchHeader(request.headers["if-none-match"]);

  const supergraphSchema = await selectCurrentSupergraphSchemaRevision(database, graph.id);
  if (!supergraphSchema) {
    return reply.problemDetails({ status: 404 });
  }

  const currentEtag = formatStrongETag(supergraphSchema.graphId, supergraphSchema.compositionRevision);

  reply.header("ETag", currentEtag);

  if (!etagSatisfiesIfNoneMatch(ifNoneMatch, currentEtag)) {
    return reply.code(304).send();
  }

  reply.header("Content-Type", "text/plain; charset=utf-8");
  return reply.code(200).send(supergraphSchema.supergraphSdl);
};
