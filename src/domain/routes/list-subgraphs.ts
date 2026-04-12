import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAuthenticatedUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { canManageGraph } from "../authorization/policy.ts";
import { selectActiveGraphBySlugForShare } from "../database/graphs/repository.ts";
import { selectActiveSubgraphsByGraphId } from "../database/subgraphs/repository.ts";
import { toSubgraphPayload } from "./payloads.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

type ListSubgraphsTransactionResult =
  | {
      kind: "forbidden";
    }
  | {
      kind: "not_found";
    }
  | {
      kind: "ok";
      subgraphs: Awaited<ReturnType<typeof selectActiveSubgraphsByGraphId>>;
    };

export const listSubgraphsHandler: DependencyInjectedHandler<
  OperationHandlers["listSubgraphs"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  const user = requireAuthenticatedUser(request, reply);
  if (!user) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const result: ListSubgraphsTransactionResult = await database.transaction(async (transaction) => {
    const graph = await selectActiveGraphBySlugForShare(transaction, request.params.graphSlug);
    if (!graph) {
      return { kind: "not_found" };
    }

    if (!canManageGraph(user.grants, graph.id)) {
      return { kind: "forbidden" };
    }

    const subgraphs = await selectActiveSubgraphsByGraphId(transaction, graph.id);

    return {
      kind: "ok",
      subgraphs,
    };
  });

  if (result.kind === "not_found") {
    return reply.problemDetails({ status: 404 });
  }

  if (result.kind === "forbidden") {
    return reply.problemDetails({ status: 403 });
  }

  return reply.code(200).send(result.subgraphs.map((subgraph) => toSubgraphPayload(subgraph)));
};
