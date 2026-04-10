import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import {
  requireAuthenticatedUser,
  requireGraphReadGrant,
} from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { selectActiveGraphBySlug } from "../database/graphs/repository.ts";
import { selectCurrentSupergraphSchemaRevision } from "../database/supergraph-schemas/repository.ts";
import { etagSatisfiesIfNoneMatch, formatStrongETag, parseIfNoneMatchHeader } from "../etag.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

export const getSupergraphSchemaHandler: DependencyInjectedHandler<
  OperationHandlers["getSupergraphSchema"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  if (!requireAuthenticatedUser(request, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const ifNoneMatch = parseIfNoneMatchHeader(request.headers["if-none-match"]);

  const graph = await selectActiveGraphBySlug(database, request.params.graphSlug);
  if (!graph) {
    return reply.problemDetails({ status: 404 });
  }

  if (!requireGraphReadGrant(request, reply, graph.id)) {
    return;
  }

  const supergraphSchema = await selectCurrentSupergraphSchemaRevision(database, graph.id);
  if (!supergraphSchema) {
    return reply.problemDetails({ status: 404 });
  }

  const currentEtag = formatStrongETag(
    supergraphSchema.graphId,
    supergraphSchema.compositionRevision,
  );

  reply.header("ETag", currentEtag);

  if (!etagSatisfiesIfNoneMatch(ifNoneMatch, currentEtag)) {
    return reply.code(304).send();
  }

  reply.header("Content-Type", "text/plain; charset=utf-8");
  return reply.code(200).send(supergraphSchema.supergraphSdl);
};
