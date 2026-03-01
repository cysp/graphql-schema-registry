import { and, eq, isNull } from "drizzle-orm";
import type { PickDeep } from "type-fest";

import { graphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";
import { requireDatabase } from "./graph-route-shared.ts";

type RouteDependencies = Readonly<{
  database: PickDeep<PostgresJsDatabase, "update"> | undefined;
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
  const deletedGraphRecords = await database
    .update(graphs)
    .set({
      deletedAt: now,
      updatedAt: now,
    })
    .where(and(eq(graphs.slug, request.params.graphSlug), isNull(graphs.deletedAt)))
    .returning({
      id: graphs.id,
    });

  if (deletedGraphRecords.length === 0) {
    reply.notFound("Graph not found.");
    return;
  }

  reply.code(204).send();
}
