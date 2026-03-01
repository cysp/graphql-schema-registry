import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";
import { getActiveGraphBySlug } from "../database/get-active-graph-by-slug.ts";
import {
  softDeleteGraphAndSubgraphsInTransaction,
} from "../database/soft-delete-graph-and-subgraphs.ts";
import { requireDatabase } from "./graph-route-shared.ts";

type RouteDependencies = Readonly<{
  database: PostgresJsDatabase | undefined;
}>;

export async function deleteGraphHandler({
  request,
  reply,
  dependencies: { database },
}: DependencyInjectedHandlerContext<
  RouteHandlers["deleteGraph"],
  RouteDependencies
>): Promise<void> {
  if (!requireDatabase(database, reply)) {
    return;
  }

  if (!requireAdminUser(request, reply)) {
    return;
  }

  const now = new Date();

  const graph = await getActiveGraphBySlug(database, request.params.graphSlug);
  if (!graph) {
    request.log.debug(
      { graphSlug: request.params.graphSlug },
      "delete requested for missing or already deleted graph",
    );
    reply.code(204).send();
    return;
  }

  const deleted = await database.transaction(async (transaction) => {
    return softDeleteGraphAndSubgraphsInTransaction(transaction, {
      graphId: graph.id,
      now,
    });
  });

  if (!deleted) {
    request.log.debug(
      { graphId: graph.id, graphSlug: request.params.graphSlug },
      "delete raced with concurrent delete",
    );
  }

  reply.code(204).send();
}
