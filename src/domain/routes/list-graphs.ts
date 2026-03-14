import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import type { FastifyOperationHandlers } from "../../lib/fastify/openapi/routes.ts";
import { requireDependency } from "../../lib/fastify/require-dependency.ts";
import { listActiveGraphs } from "../database/list-active-graphs.ts";

type RouteDependencies = Readonly<{
  database: PostgresJsDatabase | undefined;
}>;

export async function listGraphsHandler({
  request,
  reply,
  dependencies: { database },
}: DependencyInjectedHandlerContext<
  FastifyOperationHandlers["listGraphs"],
  RouteDependencies
>): Promise<void> {
  if (!requireDependency(database, reply)) {
    return;
  }

  if (!requireAdminUser(request, reply)) {
    return;
  }

  const graphs = await listActiveGraphs(database);

  reply.code(200).send(
    graphs.map((graph) => ({
      id: graph.externalId,
      slug: graph.slug,
      revisionId: String(graph.revisionId),
      federationVersion: graph.federationVersion,
      createdAt: graph.createdAt.toISOString(),
      updatedAt: graph.updatedAt.toISOString(),
    })),
  );
}
