import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";
import { listActiveGraphs } from "../database/list-active-graphs.ts";
import { requireDatabase } from "./graph-route-shared.ts";

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

  const graphs = await listActiveGraphs(database);

  reply.code(200).send(graphs.map((graph) => ({
      createdAt: graph.createdAt.toISOString(),
      federationVersion: graph.federationVersion,
      id: graph.externalId,
      revisionId: String(graph.revisionId),
      slug: graph.slug,
      updatedAt: graph.updatedAt.toISOString(),
    })));
}
