import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminGrant } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { selectGraphComposition } from "../database/graph-compositions/repository.ts";
import { selectActiveGraphBySlug } from "../database/graphs/repository.ts";
import { etagSatisfiesIfNoneMatch, formatStrongETag, parseIfNoneMatchHeader } from "../etag.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

function setCachingHeaders(
  reply: { header: (name: string, value: string) => unknown },
  etag: string,
  createdAt: Date,
): void {
  reply.header("Cache-Control", "private, must-revalidate");
  reply.header("ETag", etag);
  reply.header("Last-Modified", createdAt.toUTCString());
}

export const getSupergraphSdlHandler: DependencyInjectedHandler<
  OperationHandlers["getSupergraphSdl"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  if (!requireAdminGrant(request, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const graph = await selectActiveGraphBySlug(database, request.params.graphSlug);
  if (!graph || graph.currentGraphCompositionRevision === null) {
    return reply.problemDetails({ status: 404 });
  }

  const composition = await selectGraphComposition(
    database,
    graph.id,
    graph.currentGraphCompositionRevision,
  );
  if (!composition) {
    return reply.problemDetails({ status: 404 });
  }

  const etag = formatStrongETag(graph.id, composition.revision);
  if (!etagSatisfiesIfNoneMatch(parseIfNoneMatchHeader(request.headers["if-none-match"]), etag)) {
    setCachingHeaders(reply, etag, composition.createdAt);
    return reply.code(304).send();
  }

  setCachingHeaders(reply, etag, composition.createdAt);
  reply.type("text/plain; charset=utf-8");
  return reply.code(200).send(composition.supergraphSdl);
};
