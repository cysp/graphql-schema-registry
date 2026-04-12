import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAuthenticatedUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { canManageGraph } from "../authorization/policy.ts";
import { selectActiveSubgraphByGraphSlugAndSlug } from "../database/subgraphs/repository.ts";
import { formatStrongETag } from "../etag.ts";
import { toSubgraphPayload } from "./payloads.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

export const getSubgraphHandler: DependencyInjectedHandler<
  OperationHandlers["getSubgraph"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  const user = requireAuthenticatedUser(request, reply);
  if (!user) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const subgraph = await selectActiveSubgraphByGraphSlugAndSlug(
    database,
    request.params.graphSlug,
    request.params.subgraphSlug,
  );
  if (!subgraph) {
    return reply.problemDetails({ status: 404 });
  }

  if (!canManageGraph(user.grants, subgraph.graphId)) {
    return reply.problemDetails({ status: 403 });
  }

  reply.header("ETag", formatStrongETag(subgraph.id, subgraph.currentRevision));
  return reply.code(200).send(toSubgraphPayload(subgraph));
};
