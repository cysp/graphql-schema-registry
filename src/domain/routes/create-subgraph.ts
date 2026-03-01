import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import { requireDependency } from "../../lib/fastify/require-dependency.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";
import { createSubgraphWithInitialRevisionInTransaction } from "../database/create-subgraph-with-initial-revision.ts";
import { getActiveGraphBySlug } from "../database/get-active-graph-by-slug.ts";

type RouteDependencies = Readonly<{
  database: PostgresJsDatabase | undefined;
}>;

export async function createSubgraphHandler({
  request,
  reply,
  dependencies: { database },
}: DependencyInjectedHandlerContext<
  RouteHandlers["createSubgraph"],
  RouteDependencies
>): Promise<void> {
  if (!requireDependency(database, reply)) {
    return;
  }

  if (!requireAdminUser(request, reply)) {
    return;
  }

  const now = new Date();

  const graph = await getActiveGraphBySlug(database, request.params.graphSlug);
  if (!graph) {
    reply.notFound();
    return;
  }

  const createdSubgraph = await database.transaction(async (transaction) => {
    return createSubgraphWithInitialRevisionInTransaction(transaction, {
      graphId: graph.id,
      slug: request.body.slug,
      routingUrl: request.body.routingUrl,
      now,
    });
  });

  if (!createdSubgraph) {
    reply.conflict();
    return;
  }

  reply.code(201).send({
    id: createdSubgraph.externalId,
    graphId: graph.externalId,
    slug: createdSubgraph.slug,
    revisionId: String(createdSubgraph.revisionId),
    routingUrl: createdSubgraph.routingUrl,
    createdAt: createdSubgraph.createdAt.toISOString(),
    updatedAt: createdSubgraph.updatedAt.toISOString(),
  });
}
