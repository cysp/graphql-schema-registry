import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import type { FastifyOperationHandlers } from "../../lib/fastify/openapi/routes.ts";
import { requireDependency } from "../../lib/fastify/require-dependency.ts";
import { getActiveGraphBySlug } from "../database/get-active-graph-by-slug.ts";
import { listActiveSubgraphsByGraphId } from "../database/list-active-subgraphs-by-graph-id.ts";

type RouteDependencies = Readonly<{
  database: PostgresJsDatabase | undefined;
}>;

export async function listSubgraphsHandler({
  request,
  reply,
  dependencies: { database },
}: DependencyInjectedHandlerContext<
  FastifyOperationHandlers["listSubgraphs"],
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

  const subgraphs = await listActiveSubgraphsByGraphId(database, graph.id);
  reply.code(200).send(
    subgraphs.map((subgraph) => ({
      id: subgraph.externalId,
      graphId: graph.externalId,
      slug: subgraph.slug,
      revisionId: String(subgraph.revisionId),
      routingUrl: subgraph.routingUrl,
      createdAt: subgraph.createdAt.toISOString(),
      updatedAt: subgraph.updatedAt.toISOString(),
    })),
  );
}
