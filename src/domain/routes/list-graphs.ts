import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { listActiveGraphs } from "../database/list-active-graphs.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";
import type { Graph } from "../../lib/openapi-ts/types.gen.ts";

type RouteDependencies = Readonly<{
  database: PostgresJsDatabase | undefined;
}>;

export async function listGraphsHandler({
  dependencies,
  reply,
  request,
}: DependencyInjectedHandlerContext<RouteHandlers["listGraphs"], RouteDependencies>): Promise<void> {
  if (!requireAdminUser(request, reply)) {
    return;
  }

  const { database } = dependencies;
  if (!database) {
    reply.serviceUnavailable("Database is not configured.");
    return;
  }

  const activeGraphs = await listActiveGraphs(database);

  const graphResponses: Graph[] = [];
  for (const graph of activeGraphs) {
    if (!graph.currentRevision) {
      reply.internalServerError("Graph is missing a current revision.");
      return;
    }

    graphResponses.push({
      createdAt: graph.createdAt.toISOString(),
      federationVersion: graph.currentRevision.federationVersion,
      id: graph.externalId,
      revisionId: String(graph.currentRevision.revisionId),
      slug: graph.slug,
      updatedAt: graph.updatedAt.toISOString(),
    });
  }

  reply.code(200).send(graphResponses);
}
