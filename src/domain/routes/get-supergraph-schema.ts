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
type StreamSnapshotTrigger = "initial_snapshot" | "update_notification";
type StreamSnapshotState = "emitted" | "skipped_empty" | "skipped_unchanged";
type StreamState = {
  closed: boolean;
  heartbeatTimer: NodeJS.Timeout | undefined;
  lastSeenRevision: bigint | undefined;
  lastSentEtag: string | undefined;
  teardownPromise: Promise<void> | undefined;
  writeTransition: Promise<void>;
};

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

function logOpenedSupergraphSchemaSseStream(
  request: FastifyRequest,
  graphId: string,
  initialSnapshotState: StreamSnapshotState,
  state: StreamState,
): void {
  request.log.debug(
    {
      graphId,
      initialSnapshotState,
      lastSeenRevision: formatLoggedRevision(state.lastSeenRevision),
      resumedFromEtag: state.lastSentEtag,
    },
    "opened supergraph schema SSE stream",
  );
}

function logClosedSupergraphSchemaSseStream(
  request: FastifyRequest,
  graphId: string,
  state: StreamState,
): void {
  request.log.info(
    {
      graphId,
      lastSeenRevision: formatLoggedRevision(state.lastSeenRevision),
    },
    "closed supergraph schema SSE stream",
  );
}

function logSupergraphSchemaSseFailure(
  request: FastifyRequest,
  graphId: string,
  error: unknown,
): void {
  if (error instanceof SupergraphSchemaUpdateBrokerFailure) {
    request.log.warn(
      {
        error,
        graphId,
      },
      "supergraph schema SSE stream ended after broker failure",
    );
    return;
  }

  request.log.warn(
    { error, graphId },
    "failed to publish supergraph schema SSE update",
  );
}

function shouldIgnoreNotification(
  notification: SupergraphSchemaUpdatedNotification,
  graphId: string,
  lastSeenRevision: bigint | undefined,
): boolean {
  return notification.graphId !== graphId || (
    lastSeenRevision !== undefined && notification.compositionRevision <= lastSeenRevision
  );
}

function logIgnoredNotification(
  request: FastifyRequest,
  graphId: string,
  lastSeenRevision: bigint | undefined,
  notification: SupergraphSchemaUpdatedNotification,
): void {
  if (notification.graphId !== graphId) {
    return;
  }

  request.log.debug(
    {
      graphId,
      lastSeenRevision: formatLoggedRevision(lastSeenRevision),
      notificationRevision: String(notification.compositionRevision),
    },
    "ignored stale supergraph schema update notification",
  );
}

async function handleSupergraphSchemaSse(
  database: PostgresJsDatabase,
  supergraphSchemaUpdateBroker: SupergraphSchemaUpdateBroker | undefined,
  graph: RouteGraph,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  let cursor: ReturnType<typeof resolveSupergraphSchemaStreamCursor>;
  try {
    cursor = resolveSupergraphSchemaStreamCursor(request.headers["last-event-id"], graph.id);
  } catch {
    await reply.problemDetails({ status: 400 });
    return;
  }

  if (!supergraphSchemaUpdateBroker) {
    await reply.problemDetails({ status: 503 });
    return;
  }

  let notifications: AsyncGenerator<SupergraphSchemaUpdatedNotification, void, void>;
  try {
    notifications = await supergraphSchemaUpdateBroker.subscribe(graph.id);
  } catch (error) {
    request.log.warn({ error }, "failed to listen for supergraph schema updates");
    await reply.problemDetails({ status: 503 });
    return;
  }

  const state: StreamState = {
    closed: false,
    heartbeatTimer: undefined,
    lastSeenRevision: cursor.lastSeenRevision,
    lastSentEtag: cursor.lastSentEtag,
    teardownPromise: undefined,
    writeTransition: Promise.resolve(),
  };

  async function closeStream({ endResponse }: { endResponse: boolean }): Promise<void> {
    if (state.teardownPromise) {
      await state.teardownPromise;
      return;
    }

    state.teardownPromise = (async () => {
      if (state.closed) {
        return;
      }

      state.closed = true;

      if (state.heartbeatTimer) {
        clearInterval(state.heartbeatTimer);
      }

      try {
        await notifications.return();
      } catch (error) {
        request.log.warn({ error }, "failed to unlisten supergraph schema updates");
      }

      if (endResponse && !reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.end();
      }
    })();

    await state.teardownPromise;
  }

  async function serializeWrite(fn: () => Promise<void>): Promise<void> {
    const previousTransition = state.writeTransition;
    let releaseTransition!: () => void;
    state.writeTransition = new Promise<void>((resolve) => {
      releaseTransition = resolve;
    });

    try {
      await previousTransition;
      await fn();
    } finally {
      releaseTransition();
    }
  }

  async function emitLatestSnapshot(trigger: StreamSnapshotTrigger): Promise<StreamSnapshotState> {
    const currentSupergraphSchema = await selectCurrentSupergraphSchemaSnapshot(database, graph.id);
    if (!currentSupergraphSchema) {
      return "skipped_empty";
    }

    if (state.closed || currentSupergraphSchema.etag === state.lastSentEtag) {
      return "skipped_unchanged";
    }

    await serializeWrite(async () => {
      await writeSupergraphSchemaSseEvent(
        reply.raw,
        currentSupergraphSchema.etag,
        currentSupergraphSchema.supergraphSdl,
      );
    });

    state.lastSentEtag = currentSupergraphSchema.etag;
    state.lastSeenRevision = currentSupergraphSchema.compositionRevision;
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
  }

  function handleClientDisconnect(): void {
    // oxlint-disable-next-line eslint(no-void)
    void closeStream({ endResponse: false });
  }

  function startHeartbeat(): void {
    state.heartbeatTimer = setInterval(() => {
      if (state.closed || reply.raw.writableEnded) {
        return;
      }

      // oxlint-disable-next-line eslint(no-void)
      void serializeWrite(async () => {
        try {
          await writeSupergraphSchemaSseHeartbeat(reply.raw);
        } catch (error) {
          if (state.closed) {
            return;
          }

          request.log.warn(
            { error, graphId: graph.id },
            "failed to write supergraph schema SSE heartbeat",
          );
          await closeStream({ endResponse: true });
        }
      });
    }, 25_000);
  }

  reply.hijack();
  reply.raw.writeHead(200, {
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
  });

  request.raw.once("close", () => {
    handleClientDisconnect();
  });
  startHeartbeat();

  try {
    const initialSnapshotState = await emitLatestSnapshot("initial_snapshot");
    logOpenedSupergraphSchemaSseStream(request, graph.id, initialSnapshotState, state);

    for await (const notification of notifications) {
      if (shouldIgnoreNotification(notification, graph.id, state.lastSeenRevision)) {
        logIgnoredNotification(request, graph.id, state.lastSeenRevision, notification);
        continue;
      }

      await emitLatestSnapshot("update_notification");
    }
  } catch (error) {
    logSupergraphSchemaSseFailure(request, graph.id, error);
  } finally {
    await closeStream({ endResponse: true });
    logClosedSupergraphSchemaSseStream(request, graph.id, state);
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
