import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAuthenticatedUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { canManageGraph } from "../authorization/policy.ts";
import {
  selectActiveGraphBySlugForUpdate,
  softDeleteGraphAndSubgraphsById,
} from "../database/graphs/repository.ts";
import { etagSatisfiesIfMatch, formatStrongETag, parseIfMatchHeader } from "../etag.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

export const deleteGraphHandler: DependencyInjectedHandler<
  OperationHandlers["deleteGraph"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  const user = requireAuthenticatedUser(request, reply);
  if (!user) {
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

    if (!canManageGraph(user.grants, graph.id)) {
      return { kind: "forbidden" } as const;
    }

    if (!etagSatisfiesIfMatch(ifMatch, formatStrongETag(graph.id, graph.currentRevision))) {
      return { kind: "precondition_failed" } as const;
    }

    await softDeleteGraphAndSubgraphsById(transaction, graph.id, now);

    return { kind: "no_content" } as const;
  });

  if (result.kind === "precondition_failed") {
    return reply.problemDetails({ status: 412 });
  }

  if (result.kind === "forbidden") {
    return reply.problemDetails({ status: 403 });
  }

  return reply.code(204).send();
};
