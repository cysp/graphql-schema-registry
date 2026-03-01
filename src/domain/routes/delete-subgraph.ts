import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import { requireDependency } from "../../lib/fastify/require-dependency.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";
import { getActiveGraphBySlug } from "../database/get-active-graph-by-slug.ts";
import { getActiveSubgraphByGraphIdAndSlug } from "../database/get-active-subgraph-by-graph-id-and-slug.ts";
import { softDeleteSubgraphInTransaction } from "../database/soft-delete-subgraph.ts";

type RouteDependencies = Readonly<{
  database: PostgresJsDatabase | undefined;
}>;

export async function deleteSubgraphHandler({
  request,
  reply,
  dependencies: { database },
}: DependencyInjectedHandlerContext<
  RouteHandlers["deleteSubgraph"],
  RouteDependencies
>): Promise<void> {
  if (!requireDependency(database, reply)) {
    return;
  }

  if (!requireAdminUser(request, reply)) {
    return;
  }

  const graph = await getActiveGraphBySlug(database, request.params.graphSlug);
  if (!graph) {
    reply.notFound();
    return;
  }

  const subgraph = await getActiveSubgraphByGraphIdAndSlug(
    database,
    graph.id,
    request.params.subgraphSlug,
  );
  if (!subgraph) {
    reply.notFound();
    return;
  }

  const now = new Date();

  const deleted = await database.transaction(async (transaction) => {
    return softDeleteSubgraphInTransaction(transaction, {
      subgraphId: subgraph.id,
      now,
    });
  });

  if (!deleted) {
    request.log.debug(
      {
        graphId: graph.id,
        graphSlug: request.params.graphSlug,
        subgraphId: subgraph.id,
        subgraphSlug: request.params.subgraphSlug,
      },
      "delete raced with concurrent subgraph delete",
    );
    reply.notFound();
    return;
  }

  reply.code(204).send();
}
