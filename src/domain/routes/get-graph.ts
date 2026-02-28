import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { getActiveGraphBySlug } from "../database/get-active-graph-by-slug.ts";
import { getAuthenticatedUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";

type RouteDependencies = Readonly<{
  database: PostgresJsDatabase | undefined;
}>;

export async function getGraphHandler({
  dependencies,
  reply,
  request,
}: DependencyInjectedHandlerContext<RouteHandlers["getGraph"], RouteDependencies>): Promise<void> {
  const user = getAuthenticatedUser(request, reply);
  if (!user) {
    return;
  }

  const { database } = dependencies;
  if (!database) {
    reply.serviceUnavailable("Database is not configured.");
    return;
  }

  const activeGraph = await getActiveGraphBySlug(database, request.params.graphSlug);

  if (!activeGraph) {
    reply.notFound("Graph not found.");
    return;
  }

  const canReadGraph = user.grants.some(
    (grant) =>
      grant.scope === "admin" ||
      (grant.scope === "graph:read" && grant.graphId === activeGraph.externalId),
  );

  if (!canReadGraph) {
    reply.forbidden();
    return;
  }

  if (!activeGraph.currentRevision) {
    reply.internalServerError("Graph is missing a current revision.");
    return;
  }

  reply.code(200).send({
    createdAt: activeGraph.createdAt.toISOString(),
    federationVersion: activeGraph.currentRevision.federationVersion,
    id: activeGraph.externalId,
    revisionId: String(activeGraph.currentRevision.revisionId),
    slug: activeGraph.slug,
    updatedAt: activeGraph.updatedAt.toISOString(),
  });
}
