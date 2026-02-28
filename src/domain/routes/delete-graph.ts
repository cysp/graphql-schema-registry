import { and, eq, isNull } from "drizzle-orm";

import { graphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";

type RouteDependencies = Readonly<{
  database: PostgresJsDatabase | undefined;
}>;

export async function deleteGraphHandler({
  dependencies,
  reply,
  request,
}: DependencyInjectedHandlerContext<
  RouteHandlers["deleteGraph"],
  RouteDependencies
>): Promise<void> {
  if (!requireAdminUser(request, reply)) {
    return;
  }

  const { database } = dependencies;
  if (!database) {
    reply.serviceUnavailable("Database is not configured.");
    return;
  }

  const now = new Date();
  const deletedGraphs = await database
    .update(graphs)
    .set({
      deletedAt: now,
      updatedAt: now,
    })
    .where(and(eq(graphs.slug, request.params.graphSlug), isNull(graphs.deletedAt)))
    .returning({
      id: graphs.id,
    });

  if (deletedGraphs.length === 0) {
    reply.notFound("Graph not found.");
    return;
  }

  reply.code(204).send();
}
