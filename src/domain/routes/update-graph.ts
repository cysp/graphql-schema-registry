import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";
import { getActiveGraphBySlug } from "../database/get-active-graph-by-slug.ts";
import {
  updateGraphWithOptimisticLockInTransaction,
} from "../database/update-graph-with-optimistic-lock.ts";
import { requireDatabase } from "./graph-route-shared.ts";

type RouteDependencies = Readonly<{
  database: PostgresJsDatabase | undefined;
}>;

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

  const now = new Date();
  const expectedRevisionId = Number.parseInt(request.headers["x-revision-id"], 10);

  const graph = await getActiveGraphBySlug(database, request.params.graphSlug);
  if (!graph) {
    reply.notFound();
    return;
  }

  if (graph.revisionId !== expectedRevisionId) {
    reply.conflict();
    return;
  }

  const updatedGraph = await database.transaction(async (transaction) => {
    return updateGraphWithOptimisticLockInTransaction(transaction, {
      graphId: graph.id,
      currentRevisionId: graph.revisionId,
      federationVersion: request.body.federationVersion,
      now,
    });
  });

  if (!updatedGraph) {
    reply.conflict();
    return;
  }

  reply.code(200).send({
    createdAt: updatedGraph.createdAt.toISOString(),
    federationVersion: updatedGraph.federationVersion,
    id: updatedGraph.externalId,
    revisionId: String(updatedGraph.revisionId),
    slug: updatedGraph.slug,
    updatedAt: updatedGraph.updatedAt.toISOString(),
  });
}
