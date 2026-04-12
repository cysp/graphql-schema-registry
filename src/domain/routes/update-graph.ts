import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAuthenticatedUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { canManageGraph } from "../authorization/policy.ts";
import { selectActiveGraphBySlugForUpdate } from "../database/graphs/repository.ts";
import type { ActiveGraph } from "../database/types.ts";
import { etagSatisfiesIfMatch, formatStrongETag, parseIfMatchHeader } from "../etag.ts";
import { toGraphPayload } from "./payloads.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

type UpdateGraphTransactionResult =
  | {
      kind: "forbidden";
    }
  | {
      kind: "not_found";
    }
  | {
      kind: "precondition_failed";
    }
  | {
      kind: "ok";
      graph: ActiveGraph;
    };

export const updateGraphHandler: DependencyInjectedHandler<
  OperationHandlers["updateGraph"],
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

  const result: UpdateGraphTransactionResult = await database.transaction(async (transaction) => {
    let graph = await selectActiveGraphBySlugForUpdate(transaction, request.params.graphSlug);

    if (
      !etagSatisfiesIfMatch(ifMatch, graph && formatStrongETag(graph.id, graph.currentRevision))
    ) {
      return { kind: "precondition_failed" };
    }

    if (!graph) {
      return { kind: "not_found" };
    }

    if (!canManageGraph(user.grants, graph.id)) {
      return { kind: "forbidden" };
    }

    return {
      graph,
      kind: "ok",
    };
  });

  if (result.kind === "precondition_failed") {
    return reply.problemDetails({ status: 412 });
  }

  if (result.kind === "not_found") {
    return reply.problemDetails({ status: 404 });
  }

  if (result.kind === "forbidden") {
    return reply.problemDetails({ status: 403 });
  }

  reply.header("ETag", formatStrongETag(result.graph.id, result.graph.currentRevision));
  return reply.code(200).send(toGraphPayload(result.graph));
};
