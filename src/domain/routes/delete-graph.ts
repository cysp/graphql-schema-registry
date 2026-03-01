import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";
import {
  softDeleteGraphAndSubgraphsInTransaction,
} from "../database/soft-delete-graph-and-subgraphs.ts";
import { requireDatabase } from "./graph-route-shared.ts";

type RouteDependencies = Readonly<{
  database: PostgresJsDatabase | undefined;
}>;

export async function deleteGraphHandler({
  request,
  reply,
  dependencies: { database },
}: DependencyInjectedHandlerContext<
  RouteHandlers["deleteGraph"],
  RouteDependencies
>): Promise<void> {
  if (!requireDatabase(database, reply)) {
    return;
  }

  if (!requireAdminUser(request, reply)) {
    return;
  }

  const now = new Date();

  await database.transaction(async (transaction): Promise<void> => {
    await softDeleteGraphAndSubgraphsInTransaction(transaction, {
      now,
      slug: request.params.graphSlug,
    });
  });

  reply.code(204).send();
}
