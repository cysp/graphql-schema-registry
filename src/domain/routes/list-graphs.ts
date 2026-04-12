import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAuthenticatedUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { canManageAnyGraph, canManageGraph } from "../authorization/policy.ts";
import { selectActiveGraphs } from "../database/graphs/repository.ts";
import { toGraphPayload } from "./payloads.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

export const listGraphsHandler: DependencyInjectedHandler<
  OperationHandlers["listGraphs"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  const user = requireAuthenticatedUser(request, reply);
  if (!user) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const graphs = await selectActiveGraphs(database);
  if (canManageAnyGraph(user.grants)) {
    return reply.code(200).send(graphs.map((graph) => toGraphPayload(graph)));
  }

  const visibleGraphs = graphs.filter((graph) => canManageGraph(user.grants, graph.id));
  return reply.code(200).send(visibleGraphs.map((graph) => toGraphPayload(graph)));
};
