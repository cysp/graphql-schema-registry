import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { selectActiveGraphBySlugForUpdate } from "../database/graph-records.ts";
import { softDeleteGraphAndSubgraphsById } from "../database/graph-write-helpers.ts";
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
  if (!requireAdminUser(request, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const ifMatch = parseIfMatchHeader(request.headers["if-match"]);

  const result = await database.transaction(async (transaction) => {
    const now = new Date();

    const graph = await selectActiveGraphBySlugForUpdate(transaction, request.params.graphSlug);

    if (!etagSatisfiesIfMatch(ifMatch, graph && formatStrongETag(graph.id, graph.revision))) {
      return { kind: "precondition_failed" } as const;
    }

    if (!graph) {
      return { kind: "no_content" } as const;
    }

    await softDeleteGraphAndSubgraphsById(transaction, graph.id, now);

    return { kind: "no_content" } as const;
  });

  if (result.kind === "precondition_failed") {
    return reply.problemDetails({ status: 412 });
  }

  return reply.code(204).send();
};
