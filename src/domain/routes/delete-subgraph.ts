import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminGrant } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { attemptRecomposeGraph } from "../composition.ts";
import { selectActiveGraphBySlugForUpdate } from "../database/graphs/repository.ts";
import {
  selectActiveSubgraphByGraphIdAndSlugForUpdate,
  softDeleteSubgraphById,
} from "../database/subgraphs/repository.ts";
import { etagSatisfiesIfMatch, formatStrongETag, parseIfMatchHeader } from "../etag.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

export const deleteSubgraphHandler: DependencyInjectedHandler<
  OperationHandlers["deleteSubgraph"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  if (!requireAdminGrant(request, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const ifMatch = parseIfMatchHeader(request.headers["if-match"]);

  const result = await database.transaction(async (transaction) => {
    const now = new Date();

    const graph = await selectActiveGraphBySlugForUpdate(transaction, request.params.graphSlug);
    if (!graph) {
      if (!etagSatisfiesIfMatch(ifMatch, undefined)) {
        return { kind: "precondition_failed" } as const;
      }

      return { kind: "no_content" } as const;
    }

    const subgraph = await selectActiveSubgraphByGraphIdAndSlugForUpdate(
      transaction,
      graph.id,
      request.params.subgraphSlug,
    );

    if (
      !etagSatisfiesIfMatch(
        ifMatch,
        subgraph && formatStrongETag(subgraph.id, subgraph.currentRevision),
      )
    ) {
      return { kind: "precondition_failed" } as const;
    }

    if (!subgraph) {
      return { kind: "no_content" } as const;
    }

    await softDeleteSubgraphById(transaction, subgraph.id, now);
    await attemptRecomposeGraph(transaction, graph, now);

    return { kind: "no_content" } as const;
  });

  if (result.kind === "precondition_failed") {
    return reply.problemDetails({ status: 412 });
  }

  return reply.code(204).send();
};
