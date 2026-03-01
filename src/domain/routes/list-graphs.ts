import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";
import type { Graph } from "../../lib/openapi-ts/types.gen.ts";
import { listActiveGraphs } from "../database/list-active-graphs.ts";
import { GRAPH_MISSING_CURRENT_REVISION_MESSAGE, requireDatabase } from "./graph-route-shared.ts";

type RouteDependencies = Readonly<{
  database: PostgresJsDatabase | undefined;
}>;

export async function listGraphsHandler({
  request,
  reply,
  dependencies: { database },
}: DependencyInjectedHandlerContext<
  RouteHandlers["listGraphs"],
  RouteDependencies
>): Promise<void> {
  if (!requireDatabase(database, reply)) {
    return;
  }

  if (!requireAdminUser(request, reply)) {
    return;
  }

  const graphRecords = await listActiveGraphs(database);

  const responseGraphs: Graph[] = [];
  for (const graphRecord of graphRecords) {
    const revisionRecord = graphRecord.currentRevision;
    if (!revisionRecord) {
      reply.internalServerError(GRAPH_MISSING_CURRENT_REVISION_MESSAGE);
      return;
    }

    responseGraphs.push({
      createdAt: graphRecord.createdAt.toISOString(),
      federationVersion: revisionRecord.federationVersion,
      id: graphRecord.externalId,
      revisionId: String(revisionRecord.revisionId),
      slug: graphRecord.slug,
      updatedAt: graphRecord.updatedAt.toISOString(),
    });
  }

  reply.code(200).send(responseGraphs);
}
