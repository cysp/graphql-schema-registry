import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";
import { getActiveGraphBySlug } from "../database/get-active-graph-by-slug.ts";
import { requireDatabase } from "./graph-route-shared.ts";

type RouteDependencies = Readonly<{
  database: PostgresJsDatabase | undefined;
}>;

export async function getGraphHandler({
  request,
  reply,
  dependencies: { database },
}: DependencyInjectedHandlerContext<RouteHandlers["getGraph"], RouteDependencies>): Promise<void> {
  if (!requireDatabase(database, reply)) {
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

  reply.code(200).send({
    createdAt: graph.createdAt.toISOString(),
    federationVersion: graph.federationVersion,
    id: graph.externalId,
    revisionId: String(graph.revisionId),
    slug: graph.slug,
    updatedAt: graph.updatedAt.toISOString(),
  });
}
