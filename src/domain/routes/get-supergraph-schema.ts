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
import { etagSatisfiesIfNoneMatch, parseIfNoneMatchHeader } from "../etag.ts";
import {
  formatSupergraphSchemaSnapshot,
  resolveSupergraphSchemaStreamCursor,
  type SupergraphSchemaSnapshot,
  writeSupergraphSchemaSseEvent,
  writeSupergraphSchemaSseHeartbeat,
} from "../supergraph-schema-stream.ts";
import {
  type SupergraphSchemaUpdateBroker,
  SupergraphSchemaUpdateBrokerFailure,
} from "../supergraph-schema-update-broker.ts";
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

function formatLoggedRevision(revision: bigint | undefined): string | undefined {
  return revision === undefined ? undefined : String(revision);
}

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

async function selectCurrentSupergraphSchemaSnapshot(
  database: PostgresJsDatabase,
  graphId: string,
): Promise<SupergraphSchemaSnapshot | undefined> {
  const currentSupergraphSchemaRevision = await selectCurrentSupergraphSchemaRevision(
    database,
    graphId,
  );
  if (!currentSupergraphSchemaRevision) {
    return undefined;
  }

  return formatSupergraphSchemaSnapshot(currentSupergraphSchemaRevision);
}

async function handleSupergraphSchemaSse(
  database: PostgresJsDatabase,
  supergraphSchemaUpdateBroker: SupergraphSchemaUpdateBroker | undefined,
  graph: RouteGraph,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  let closed = false;
  let endReason:
    | "broker_closed"
    | "broker_failed"
    | "client_disconnect"
    | "publish_failed"
    | undefined;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let notifications: AsyncGenerator<SupergraphSchemaUpdatedNotification, void, void> | undefined;
  let teardownPromise: Promise<void> | undefined;
  let streamStarted = false;
  let writeTransition = Promise.resolve();
  let { lastSeenRevision, lastSentEtag } = {
    lastSeenRevision: undefined as bigint | undefined,
    lastSentEtag: undefined as string | undefined,
  };

  try {
    ({ lastSeenRevision, lastSentEtag } = resolveSupergraphSchemaStreamCursor(
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

      if (endResponse && streamStarted && !reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.end();
      }
    })();

    await teardownPromise;
  };

  const serializeWrite = async (fn: () => Promise<void>): Promise<void> => {
    const previousTransition = writeTransition;
    let releaseTransition!: () => void;
    writeTransition = new Promise<void>((resolve) => {
      releaseTransition = resolve;
    });

    try {
      await previousTransition;
      await fn();
    } finally {
      releaseTransition();
    }
  };

  const emitLatest = async (
    trigger: "initial_snapshot" | "update_notification",
  ): Promise<"emitted" | "skipped_empty" | "skipped_unchanged"> => {
    const currentSupergraphSchema = await selectCurrentSupergraphSchemaSnapshot(database, graph.id);
    if (!currentSupergraphSchema) {
      return "skipped_empty";
    }

    if (currentSupergraphSchema.etag === lastSentEtag || closed) {
      return "skipped_unchanged";
    }

    await serializeWrite(async () => {
      await writeSupergraphSchemaSseEvent(
        reply.raw,
        currentSupergraphSchema.etag,
        currentSupergraphSchema.supergraphSdl,
      );
    });
    lastSentEtag = currentSupergraphSchema.etag;
    lastSeenRevision = currentSupergraphSchema.compositionRevision;
    request.log.debug(
      {
        etag: currentSupergraphSchema.etag,
        graphId: graph.id,
        revision: String(currentSupergraphSchema.compositionRevision),
        trigger,
      },
      "emitted supergraph schema SSE snapshot",
    );
    return "emitted";
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
    endReason ??= "client_disconnect";
    // oxlint-disable-next-line eslint(no-void)
    void teardown({ endResponse: false });
  });

  heartbeatTimer = setInterval(() => {
    if (closed || reply.raw.writableEnded) {
      return;
    }

    // oxlint-disable-next-line eslint(no-void)
    void serializeWrite(async () => {
      try {
        await writeSupergraphSchemaSseHeartbeat(reply.raw);
      } catch (error) {
        if (closed) {
          return;
        }

        endReason ??= "publish_failed";
        request.log.warn(
          { error, graphId: graph.id },
          "failed to write supergraph schema SSE heartbeat",
        );
        await teardown({ endResponse: true });
      }
    });
  }, 25_000);

  try {
    const initialSnapshotState = await emitLatest("initial_snapshot");
    request.log.debug(
      {
        graphId: graph.id,
        initialSnapshotState,
        lastSeenRevision: formatLoggedRevision(lastSeenRevision),
        resumedFromEtag: lastSentEtag,
      },
      "opened supergraph schema SSE stream",
    );

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

      await emitLatest("update_notification");
    }
    endReason ??= "broker_closed";
  } catch (error) {
    if (error instanceof SupergraphSchemaUpdateBrokerFailure) {
      endReason ??= "broker_failed";
      request.log.warn(
        {
          error,
          graphId: graph.id,
        },
        "supergraph schema SSE stream ended after broker failure",
      );
    } else {
      endReason ??= "publish_failed";
      request.log.warn(
        { error, graphId: graph.id },
        "failed to publish supergraph schema SSE update",
      );
    }
  } finally {
    await teardown({ endResponse: true });
    request.log.info(
      {
        endReason: endReason ?? "broker_closed",
        graphId: graph.id,
        lastSeenRevision: formatLoggedRevision(lastSeenRevision),
      },
      "closed supergraph schema SSE stream",
    );
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
