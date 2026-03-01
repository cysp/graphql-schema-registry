import { and, eq, isNull } from "drizzle-orm";
import type { PickDeep } from "type-fest";

import { graphRevisions, graphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";
import type { Graph } from "../../lib/openapi-ts/types.gen.ts";
import { getActiveGraphBySlug } from "../database/get-active-graph-by-slug.ts";
import {
  GRAPH_MISSING_CURRENT_REVISION_MESSAGE,
  GRAPH_WRITE_CONFLICT_MESSAGE,
  requireDatabase,
} from "./graph-route-shared.ts";

type RouteDependencies = Readonly<{
  database: PickDeep<PostgresJsDatabase, "transaction"> | undefined;
}>;

const graphRecordFields = {
  createdAt: graphs.createdAt,
  externalId: graphs.externalId,
  id: graphs.id,
  slug: graphs.slug,
  updatedAt: graphs.updatedAt,
} as const;

type UpdateGraphResult =
  | Readonly<{ type: "conflict" }>
  | Readonly<{ type: "not_found" }>
  | Readonly<{ graph: Graph; type: "updated" }>;

export async function updateGraphHandler({
  request,
  reply,
  dependencies: { database },
}: DependencyInjectedHandlerContext<
  RouteHandlers["updateGraph"],
  RouteDependencies
>): Promise<void> {
  if (!requireDatabase(database, reply)) {
    return;
  }

  if (!requireAdminUser(request, reply)) {
    return;
  }

  const expectedRevisionId = Number.parseInt(request.headers["x-revision-id"], 10);
  const now = new Date();

  const result = await database.transaction(async (transaction): Promise<UpdateGraphResult> => {
    const existingGraph = await getActiveGraphBySlug(transaction, request.params.graphSlug);
    if (!existingGraph) {
      return { type: "not_found" };
    }

    const currentRevision = existingGraph.currentRevision;
    if (!currentRevision) {
      throw new Error(GRAPH_MISSING_CURRENT_REVISION_MESSAGE);
    }

    const currentRevisionId = currentRevision.revisionId;
    if (currentRevisionId !== expectedRevisionId) {
      return { type: "conflict" };
    }

    const nextRevisionId = currentRevisionId + 1;
    const [updatedGraphRecord] = await transaction
      .update(graphs)
      .set({
        currentRevisionId: nextRevisionId,
        updatedAt: now,
      })
      .where(
        and(
          eq(graphs.id, existingGraph.id),
          isNull(graphs.deletedAt),
          eq(graphs.currentRevisionId, currentRevisionId),
        ),
      )
      .returning(graphRecordFields);

    if (!updatedGraphRecord) {
      const [graphState] = await transaction
        .select({
          deletedAt: graphs.deletedAt,
        })
        .from(graphs)
        .where(eq(graphs.id, existingGraph.id))
        .limit(1);

      if (!graphState || graphState.deletedAt !== null) {
        return { type: "not_found" };
      }

      return { type: "conflict" };
    }

    await transaction.insert(graphRevisions).values({
      createdAt: now,
      federationVersion: request.body.federationVersion,
      graphId: updatedGraphRecord.id,
      revisionId: nextRevisionId,
    });

    return {
      type: "updated",
      graph: {
        createdAt: updatedGraphRecord.createdAt.toISOString(),
        federationVersion: request.body.federationVersion,
        id: updatedGraphRecord.externalId,
        revisionId: String(nextRevisionId),
        slug: updatedGraphRecord.slug,
        updatedAt: updatedGraphRecord.updatedAt.toISOString(),
      },
    };
  });

  if (result.type === "not_found") {
    reply.notFound("Graph not found.");
    return;
  }

  if (result.type === "conflict") {
    reply.conflict(GRAPH_WRITE_CONFLICT_MESSAGE);
    return;
  }

  reply.code(200).send(result.graph);
}
