import type { PickDeep } from "type-fest";

import { graphRevisions, graphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";
import type { Graph } from "../../lib/openapi-ts/types.gen.ts";
import { getActiveGraphBySlug } from "../database/get-active-graph-by-slug.ts";
import { GRAPH_WRITE_CONFLICT_MESSAGE, requireDatabase } from "./graph-route-shared.ts";

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

const INITIAL_GRAPH_REVISION_ID = 1;

function isUniqueViolationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  return Reflect.get(error, "code") === "23505";
}

export async function createGraphHandler({
  request,
  reply,
  dependencies: { database },
}: DependencyInjectedHandlerContext<
  RouteHandlers["createGraph"],
  RouteDependencies
>): Promise<void> {
  if (!requireDatabase(database, reply)) {
    return;
  }

  if (!requireAdminUser(request, reply)) {
    return;
  }

  const now = new Date();

  try {
    const createdGraph = await database.transaction(async (transaction): Promise<Graph | undefined> => {
      const existingGraph = await getActiveGraphBySlug(transaction, request.body.graphSlug);
      if (existingGraph) {
        return undefined;
      }

      const [graphRecord] = await transaction
        .insert(graphs)
        .values({
          createdAt: now,
          currentRevisionId: INITIAL_GRAPH_REVISION_ID,
          slug: request.body.graphSlug,
          updatedAt: now,
        })
        .returning(graphRecordFields);

      if (!graphRecord) {
        return undefined;
      }

      await transaction.insert(graphRevisions).values({
        createdAt: now,
        federationVersion: request.body.federationVersion,
        graphId: graphRecord.id,
        revisionId: INITIAL_GRAPH_REVISION_ID,
      });

      return {
        createdAt: graphRecord.createdAt.toISOString(),
        federationVersion: request.body.federationVersion,
        id: graphRecord.externalId,
        revisionId: String(INITIAL_GRAPH_REVISION_ID),
        slug: graphRecord.slug,
        updatedAt: graphRecord.updatedAt.toISOString(),
      };
    });

    if (!createdGraph) {
      reply.conflict(GRAPH_WRITE_CONFLICT_MESSAGE);
      return;
    }

    reply.code(201).send(createdGraph);
  } catch (error) {
    if (isUniqueViolationError(error)) {
      reply.conflict(GRAPH_WRITE_CONFLICT_MESSAGE);
      return;
    }

    throw error;
  }
}
