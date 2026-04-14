import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAuthenticatedUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { canReadSubgraphSchema } from "../authorization/policy.ts";
import { selectActiveGraphBySlug } from "../database/graphs/repository.ts";
import { selectCurrentSubgraphSchemaRevision } from "../database/subgraph-schemas/repository.ts";
import { selectActiveSubgraphByGraphIdAndSlug } from "../database/subgraphs/repository.ts";
import { formatStrongETag } from "../etag.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

export const getSubgraphSchemaHandler: DependencyInjectedHandler<
  OperationHandlers["getSubgraphSchema"],
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
  let subgraph;
  if (graph) {
    subgraph = await selectActiveSubgraphByGraphIdAndSlug(
      database,
      graph.id,
      request.params.subgraphSlug,
    );
  }

  if (!canReadSubgraphSchema(user.grants, graph?.id, subgraph?.id)) {
    return reply.problemDetails({ status: 403 });
  }

  if (!graph || !subgraph) {
    return reply.problemDetails({ status: 404 });
  }

  const schemaRevision = await selectCurrentSubgraphSchemaRevision(database, subgraph.id);
  if (!schemaRevision) {
    return reply.problemDetails({ status: 404 });
  }

  reply.header("Content-Type", "text/plain; charset=utf-8");
  reply.header("ETag", formatStrongETag(subgraph.id, schemaRevision.revision));
  return reply.code(200).send(schemaRevision.normalizedSdl);
};
