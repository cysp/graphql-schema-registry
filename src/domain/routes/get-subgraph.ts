import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import { requireDependency } from "../../lib/fastify/require-dependency.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";
import { getActiveGraphBySlug } from "../database/get-active-graph-by-slug.ts";
import { getActiveSubgraphByGraphIdAndSlug } from "../database/get-active-subgraph-by-graph-id-and-slug.ts";

type RouteDependencies = Readonly<{
  database: PostgresJsDatabase | undefined;
}>;

export async function getSubgraphHandler({
  request,
  reply,
  dependencies: { database },
}: DependencyInjectedHandlerContext<
  RouteHandlers["getSubgraph"],
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

  reply.code(200).send({
    id: subgraph.externalId,
    graphId: graph.externalId,
    slug: subgraph.slug,
    revisionId: String(subgraph.revisionId),
    routingUrl: subgraph.routingUrl,
    createdAt: subgraph.createdAt.toISOString(),
    updatedAt: subgraph.updatedAt.toISOString(),
  });
}
