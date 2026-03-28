import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
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
  if (!requireAdminUser(request, reply)) {
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

    return {
      kind: "ok",
      subgraphs: await selectActiveSubgraphsByGraphId(transaction, graph.id),
    };
  });

  if (result.kind === "not_found") {
    return reply.problemDetails({ status: 404 });
  }

  return reply.code(200).send(result.subgraphs.map((subgraph) => toSubgraphPayload(subgraph)));
};
