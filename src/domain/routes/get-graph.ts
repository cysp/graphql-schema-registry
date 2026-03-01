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

  const graphRecord = await getActiveGraphBySlug(database, request.params.graphSlug);

  if (!graphRecord) {
    reply.notFound("Graph not found.");
    return;
  }

  reply.code(200).send({
    createdAt: graphRecord.createdAt.toISOString(),
    federationVersion: graphRecord.federationVersion,
    id: graphRecord.externalId,
    revisionId: String(graphRecord.revisionId),
    slug: graphRecord.slug,
    updatedAt: graphRecord.updatedAt.toISOString(),
  });
}
