import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import { requireDependency } from "../../lib/fastify/require-dependency.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";
import { createSubgraphWithInitialRevisionInTransaction } from "../database/create-subgraph-with-initial-revision.ts";
import { getActiveGraphBySlug } from "../database/get-active-graph-by-slug.ts";
import { getActiveSubgraphByGraphIdAndSlug } from "../database/get-active-subgraph-by-graph-id-and-slug.ts";
import { updateSubgraphWithOptimisticLockInTransaction } from "../database/update-subgraph-with-optimistic-lock.ts";

type RouteDependencies = Readonly<{
  database: PostgresJsDatabase | undefined;
}>;

export async function upsertSubgraphHandler({
  request,
  reply,
  dependencies: { database },
}: DependencyInjectedHandlerContext<
  RouteHandlers["upsertSubgraph"],
  RouteDependencies
>): Promise<void> {
  const expectedRevisionId = Number(request.headers["x-revision-id"]);
  if (!Number.isSafeInteger(expectedRevisionId) || expectedRevisionId < 1) {
    reply.badRequest();
    return;
  }

  if (!requireDependency(database, reply)) {
    return;
  }

  if (!requireAdminUser(request, reply)) {
    return;
  }

  const now = new Date();

  const graph = await getActiveGraphBySlug(database, request.params.graphSlug);
  if (!graph) {
    reply.notFound();
    return;
  }

  const existingSubgraph = await getActiveSubgraphByGraphIdAndSlug(
    database,
    graph.id,
    request.params.subgraphSlug,
  );

  if (existingSubgraph) {
    if (existingSubgraph.revisionId !== expectedRevisionId) {
      reply.conflict();
      return;
    }

    const updatedSubgraph = await database.transaction(async (transaction) => {
      return updateSubgraphWithOptimisticLockInTransaction(transaction, {
        subgraphId: existingSubgraph.id,
        currentRevisionId: existingSubgraph.revisionId,
        routingUrl: request.body.routingUrl,
        now,
      });
    });

    if (!updatedSubgraph) {
      reply.conflict();
      return;
    }

    reply.code(200).send({
      id: updatedSubgraph.externalId,
      graphId: graph.externalId,
      slug: updatedSubgraph.slug,
      revisionId: String(updatedSubgraph.revisionId),
      routingUrl: updatedSubgraph.routingUrl,
      createdAt: updatedSubgraph.createdAt.toISOString(),
      updatedAt: updatedSubgraph.updatedAt.toISOString(),
    });
    return;
  }

  if (expectedRevisionId !== 1) {
    reply.unprocessableEntity();
    return;
  }

  const createdSubgraph = await database.transaction(async (transaction) => {
    return createSubgraphWithInitialRevisionInTransaction(transaction, {
      graphId: graph.id,
      slug: request.params.subgraphSlug,
      routingUrl: request.body.routingUrl,
      now,
    });
  });

  if (!createdSubgraph) {
    reply.conflict();
    return;
  }

  reply.code(201).send({
    id: createdSubgraph.externalId,
    graphId: graph.externalId,
    slug: createdSubgraph.slug,
    revisionId: String(createdSubgraph.revisionId),
    routingUrl: createdSubgraph.routingUrl,
    createdAt: createdSubgraph.createdAt.toISOString(),
    updatedAt: createdSubgraph.updatedAt.toISOString(),
  });
}
