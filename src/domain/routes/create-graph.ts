import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";
import {
  createGraphWithInitialRevisionInTransaction,
} from "../database/create-graph-with-initial-revision.ts";
import { requireDatabase } from "./graph-route-shared.ts";

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
  if (!requireDatabase(database, reply)) {
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
    createdAt: graph.createdAt.toISOString(),
    federationVersion: graph.federationVersion,
    id: graph.externalId,
    revisionId: String(graph.revisionId),
    slug: graph.slug,
    updatedAt: graph.updatedAt.toISOString(),
  });
}
