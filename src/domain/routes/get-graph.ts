import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import type { FastifyOperationHandlers } from "../../lib/fastify/openapi/routes.ts";
import { requireDependency } from "../../lib/fastify/require-dependency.ts";
import { getActiveGraphBySlug } from "../database/get-active-graph-by-slug.ts";

type RouteDependencies = Readonly<{
  database: PostgresJsDatabase | undefined;
}>;

export async function getGraphHandler({
  request,
  reply,
  dependencies: { database },
}: DependencyInjectedHandlerContext<
  FastifyOperationHandlers["getGraph"],
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

  reply.code(200).send({
    id: graph.externalId,
    slug: graph.slug,
    revisionId: String(graph.revisionId),
    federationVersion: graph.federationVersion,
    createdAt: graph.createdAt.toISOString(),
    updatedAt: graph.updatedAt.toISOString(),
  });
}
