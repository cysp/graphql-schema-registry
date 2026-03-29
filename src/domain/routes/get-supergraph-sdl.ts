import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import {
  hasGraphReadGrant,
  requireAuthenticatedUser,
} from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { selectCurrentGraphCompositionByGraphId } from "../database/graph-compositions.ts";
import { selectActiveGraphBySlug } from "../database/graphs/repository.ts";
import { etagSatisfiesIfNoneMatch, formatStrongETag, parseIfNoneMatchHeader } from "../etag.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

export const getSupergraphSdlHandler: DependencyInjectedHandler<
  OperationHandlers["getSupergraphSdl"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  const user = requireAuthenticatedUser(request, reply);
  if (!user) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const graph = await selectActiveGraphBySlug(database, request.params.graphSlug);
  if (!graph) {
    return reply.problemDetails({ status: 401 });
  }

  if (!hasGraphReadGrant(user, graph.id)) {
    return reply.problemDetails({ status: 401 });
  }

  if (graph.currentCompositionRevision === null) {
    return reply.problemDetails({ status: 404 });
  }

  const composition = await selectCurrentGraphCompositionByGraphId(
    database,
    graph.id,
    graph.currentCompositionRevision,
  );
  if (!composition) {
    return reply.problemDetails({ status: 404 });
  }

  const ifNoneMatch = parseIfNoneMatchHeader(request.headers["if-none-match"]);
  const currentEtag = formatStrongETag(composition.graphId, composition.revision);
  if (etagSatisfiesIfNoneMatch(ifNoneMatch, currentEtag)) {
    reply.header("Cache-Control", "no-store");
    reply.header("ETag", currentEtag);
    reply.header("Last-Modified", composition.createdAt.toUTCString());
    return reply.code(304).send();
  }

  reply.header("Cache-Control", "no-store");
  reply.header("ETag", currentEtag);
  reply.header("Last-Modified", composition.createdAt.toUTCString());
  return reply.type("text/plain").code(200).send(composition.supergraphSdl);
};
