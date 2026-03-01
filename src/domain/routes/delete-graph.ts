import { and, eq, isNull } from "drizzle-orm";
import type { PickDeep } from "type-fest";

import { graphs, subgraphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";
import { requireDatabase } from "./graph-route-shared.ts";

type RouteDependencies = Readonly<{
  database: PickDeep<PostgresJsDatabase, "transaction"> | undefined;
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
  await database.transaction(async (transaction) => {
    const [deletedGraphRecord] = await transaction
      .update(graphs)
      .set({
        deletedAt: now,
        updatedAt: now,
      })
      .where(and(eq(graphs.slug, request.params.graphSlug), isNull(graphs.deletedAt)))
      .returning({
        id: graphs.id,
      });

    if (!deletedGraphRecord) {
      return;
    }

    await transaction
      .update(subgraphs)
      .set({
        deletedAt: now,
        updatedAt: now,
      })
      .where(and(eq(subgraphs.graphId, deletedGraphRecord.id), isNull(subgraphs.deletedAt)));
  });

  reply.code(204).send();
}
