import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminGrant } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { attemptRecomposeGraph } from "../composition.ts";
import {
  insertGraphRevisionAndSetCurrent,
  selectActiveGraphBySlugForUpdate,
} from "../database/graphs/repository.ts";
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
  if (!requireAdminGrant(request, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const ifMatch = parseIfMatchHeader(request.headers["if-match"]);

  const result: UpdateGraphTransactionResult = await database.transaction(async (transaction) => {
    const now = new Date();

    let graph = await selectActiveGraphBySlugForUpdate(transaction, request.params.graphSlug);

    if (
      !etagSatisfiesIfMatch(ifMatch, graph && formatStrongETag(graph.id, graph.currentRevision))
    ) {
      return { kind: "precondition_failed" };
    }

    if (!graph) {
      return { kind: "not_found" };
    }

    let graphChanged = false;
    if (graph.federationVersion !== request.body.federationVersion) {
      graph = await insertGraphRevisionAndSetCurrent(
        transaction,
        graph.id,
        graph.currentRevision + 1,
        request.body.federationVersion,
        now,
      );
      graphChanged = true;
    }

    if (graphChanged) {
      await attemptRecomposeGraph(transaction, graph, now);
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

  reply.header("ETag", formatStrongETag(result.graph.id, result.graph.currentRevision));
  return reply.code(200).send(toGraphPayload(result.graph));
};
