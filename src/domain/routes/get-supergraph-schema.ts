import type { FastifyReply, FastifyRequest } from "fastify";

import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAuthenticatedUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { canReadSupergraphSchema } from "../authorization/policy.ts";
import { selectActiveGraphBySlug } from "../database/graphs/repository.ts";
import { selectCurrentSupergraphSchemaRevision } from "../database/supergraph-schemas/repository.ts";
import {
  etagSatisfiesIfNoneMatch,
  formatStrongETag,
  parseIfMatchHeader,
  parseIfNoneMatchHeader,
  parseResourceRevisionEntityTag,
} from "../etag.ts";
import type { SupergraphSchemaUpdateBroker } from "../supergraph-schema-update-broker.ts";
import type { SupergraphSchemaUpdatedNotification } from "../supergraph-schema-updates.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
  supergraphSchemaUpdateBroker: SupergraphSchemaUpdateBroker | undefined;
};

type RouteGraph = NonNullable<Awaited<ReturnType<typeof selectActiveGraphBySlug>>>;

type CurrentSupergraphSchemaSnapshot = {
  etag: string;
  graphId: string;
  compositionRevision: bigint;
  supergraphSdl: string;
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

function resolveSchemaStreamCursor(
  lastEventIdHeader: string | string[] | undefined,
  graphId: string,
): {
  lastSeenRevision: bigint | undefined;
  lastSentEtag: string | undefined;
} {
  const condition = parseIfMatchHeader(lastEventIdHeader);
  if (condition === undefined) {
    return {
      lastSeenRevision: undefined,
      lastSentEtag: undefined,
    };
  }

  if (condition.kind === "wildcard" || condition.entityTags.length !== 1) {
    throw new Error("Last-Event-ID must be a single entity-tag value.");
  }

  const [entityTag] = condition.entityTags;
  if (entityTag === undefined) {
    throw new Error("Last-Event-ID must be a single entity-tag value.");
  }

  const parsedEntityTag = parseResourceRevisionEntityTag(entityTag);
  if (!parsedEntityTag || parsedEntityTag.weak) {
    throw new Error("Last-Event-ID must be a single strong entity-tag value.");
  }

  if (parsedEntityTag.resourceId !== graphId) {
    return {
      lastSeenRevision: undefined,
      lastSentEtag: undefined,
    };
  }

  return {
    lastSeenRevision: parsedEntityTag.revision,
    lastSentEtag: entityTag,
  };
}

function writeSseEvent(response: NodeJS.WritableStream, eventId: string, sdl: string): void {
  response.write(`id: ${eventId}\n`);
  response.write("event: schema\n");
  for (const line of sdl.split(/\r?\n/u)) {
    response.write(`data: ${line}\n`);
  }
  response.write("\n");
}

async function selectCurrentSupergraphSchemaSnapshot(
  database: PostgresJsDatabase,
  graphId: string,
): Promise<CurrentSupergraphSchemaSnapshot | undefined> {
  const currentSupergraphSchemaRevision = await selectCurrentSupergraphSchemaRevision(database, graphId);
  if (!currentSupergraphSchemaRevision) {
    return undefined;
  }

  return {
    compositionRevision: currentSupergraphSchemaRevision.compositionRevision,
    etag: formatStrongETag(
      currentSupergraphSchemaRevision.graphId,
      currentSupergraphSchemaRevision.compositionRevision,
    ),
    graphId: currentSupergraphSchemaRevision.graphId,
    supergraphSdl: currentSupergraphSchemaRevision.supergraphSdl,
  };
}

async function handleSupergraphSchemaSse(
  database: PostgresJsDatabase,
  supergraphSchemaUpdateBroker: SupergraphSchemaUpdateBroker | undefined,
  graph: RouteGraph,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  let closed = false;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let notifications: AsyncGenerator<SupergraphSchemaUpdatedNotification, void, void> | undefined;
  let teardownPromise: Promise<void> | undefined;
  let streamStarted = false;
  let { lastSeenRevision, lastSentEtag } = {
    lastSeenRevision: undefined as bigint | undefined,
    lastSentEtag: undefined as string | undefined,
  };

  try {
    ({ lastSeenRevision, lastSentEtag } = resolveSchemaStreamCursor(
      request.headers["last-event-id"],
      graph.id,
    ));
  } catch {
    await reply.problemDetails({ status: 400 });
    return;
  }

  const teardown = async ({ endResponse }: { endResponse: boolean }): Promise<void> => {
    if (teardownPromise) {
      await teardownPromise;
      return;
    }

    teardownPromise = (async () => {
      if (closed) {
        return;
      }

      closed = true;

      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }

      if (notifications) {
        try {
          await notifications.return();
        } catch (error) {
          request.log.warn({ error }, "failed to unlisten supergraph schema updates");
        }
      }

      if (
        endResponse &&
        streamStarted &&
        !reply.raw.destroyed &&
        !reply.raw.writableEnded
      ) {
        reply.raw.end();
      }
    })();

    await teardownPromise;
  };

  const emitLatest = async (): Promise<void> => {
    const currentSupergraphSchema = await selectCurrentSupergraphSchemaSnapshot(database, graph.id);
    if (!currentSupergraphSchema) {
      return;
    }

    if (currentSupergraphSchema.etag === lastSentEtag || closed) {
      return;
    }

    writeSseEvent(reply.raw, currentSupergraphSchema.etag, currentSupergraphSchema.supergraphSdl);
    lastSentEtag = currentSupergraphSchema.etag;
    lastSeenRevision = currentSupergraphSchema.compositionRevision;
  };

  if (!supergraphSchemaUpdateBroker) {
    await reply.problemDetails({ status: 503 });
    return;
  }

  try {
    notifications = await supergraphSchemaUpdateBroker.subscribe(graph.id);
  } catch (error) {
    request.log.warn({ error }, "failed to listen for supergraph schema updates");
    await reply.problemDetails({ status: 503 });
    return;
  }

  reply.hijack();
  streamStarted = true;
  reply.raw.writeHead(200, {
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
  });

  request.raw.once("close", () => {
    // oxlint-disable-next-line eslint(no-void)
    void teardown({ endResponse: false });
  });

  heartbeatTimer = setInterval(() => {
    if (closed || reply.raw.writableEnded) {
      return;
    }

    reply.raw.write(": heartbeat\n\n");
  }, 25_000);

  try {
    await emitLatest();

    for await (const notification of notifications) {
      if (notification.graphId !== graph.id) {
        continue;
      }

      if (lastSeenRevision !== undefined && notification.compositionRevision <= lastSeenRevision) {
        request.log.debug(
          {
            graphId: graph.id,
            lastSeenRevision: String(lastSeenRevision),
            notificationRevision: String(notification.compositionRevision),
          },
          "ignored stale supergraph schema update notification",
        );
        continue;
      }

      await emitLatest();
    }
  } catch (error) {
    request.log.warn({ error }, "failed to publish supergraph schema SSE update");
  } finally {
    await teardown({ endResponse: true });
  }
}

async function handleSupergraphSchemaGet(
  database: PostgresJsDatabase,
  graph: RouteGraph,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const ifNoneMatch = parseIfNoneMatchHeader(request.headers["if-none-match"]);
  const currentSupergraphSchema = await selectCurrentSupergraphSchemaSnapshot(database, graph.id);
  if (!currentSupergraphSchema) {
    await reply.problemDetails({ status: 404 });
    return;
  }

  reply.header("ETag", currentSupergraphSchema.etag);

  if (!etagSatisfiesIfNoneMatch(ifNoneMatch, currentSupergraphSchema.etag)) {
    await reply.code(304).send();
    return;
  }

  reply.header("Content-Type", "text/plain; charset=utf-8");
  await reply.code(200).send(currentSupergraphSchema.supergraphSdl);
}

export const getSupergraphSchemaHandler: DependencyInjectedHandler<
  OperationHandlers["getSupergraphSchema"],
  RouteDependencies
> = async ({ dependencies: { database, supergraphSchemaUpdateBroker }, request, reply }) => {
  const user = requireAuthenticatedUser(request, reply);
  if (!user) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const graph = await selectActiveGraphBySlug(database, request.params.graphSlug);

  if (!canReadSupergraphSchema(user.grants, graph?.id)) {
    return reply.problemDetails({ status: 403 });
  }

  if (!graph) {
    return reply.problemDetails({ status: 404 });
  }

  if (acceptsServerSentEvents(request.headers.accept)) {
    await handleSupergraphSchemaSse(database, supergraphSchemaUpdateBroker, graph, request, reply);
    return;
  }

  await handleSupergraphSchemaGet(database, graph, request, reply);
};
