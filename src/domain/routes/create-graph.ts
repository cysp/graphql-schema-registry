import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import { requireDependency } from "../../lib/fastify/require-dependency.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";
import { createGraphWithInitialRevisionInTransaction } from "../database/create-graph-with-initial-revision.ts";

type RouteDependencies = Readonly<{
  database: PostgresJsDatabase | undefined;
}>;

export async function createGraphHandler({
  request,
  reply,
  dependencies: { database },
}: DependencyInjectedHandlerContext<
  RouteHandlers["createGraph"],
  RouteDependencies
>): Promise<void> {
  if (!requireDependency(database, reply)) {
    return;
  }

  if (!requireAdminUser(request, reply)) {
    return;
  }

  const now = new Date();

  const graph = await database.transaction(async (transaction) => {
    return createGraphWithInitialRevisionInTransaction(transaction, {
      federationVersion: request.body.federationVersion,
      now,
      slug: request.body.graphSlug,
    });
  });

  if (!graph) {
    reply.conflict();
    return;
  }

  reply.code(201).send({
    id: graph.externalId,
    slug: graph.slug,
    revisionId: String(graph.revisionId),
    federationVersion: graph.federationVersion,
    createdAt: graph.createdAt.toISOString(),
    updatedAt: graph.updatedAt.toISOString(),
  });
}
