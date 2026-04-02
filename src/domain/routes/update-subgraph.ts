import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminGrant } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { selectActiveGraphBySlugForUpdate } from "../database/graphs/repository.ts";
import {
  insertSubgraphRevisionAndSetCurrent,
  selectActiveSubgraphByGraphIdAndSlugForUpdate,
} from "../database/subgraphs/repository.ts";
import type { ActiveSubgraph } from "../database/types.ts";
import { etagSatisfiesIfMatch, formatStrongETag, parseIfMatchHeader } from "../etag.ts";
import { toSubgraphPayload } from "./payloads.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

type UpdateSubgraphTransactionResult =
  | {
      kind: "not_found";
    }
  | {
      kind: "precondition_failed";
    }
  | {
      kind: "ok";
      subgraph: ActiveSubgraph;
    };

export const updateSubgraphHandler: DependencyInjectedHandler<
  OperationHandlers["updateSubgraph"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  if (!requireAdminGrant(request, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const ifMatch = parseIfMatchHeader(request.headers["if-match"]);

  const result: UpdateSubgraphTransactionResult = await database.transaction(
    async (transaction) => {
      const now = new Date();

      const graph = await selectActiveGraphBySlugForUpdate(transaction, request.params.graphSlug);
      if (!graph) {
        if (!etagSatisfiesIfMatch(ifMatch, undefined)) {
          return { kind: "precondition_failed" };
        }

        return { kind: "not_found" };
      }

      let subgraph = await selectActiveSubgraphByGraphIdAndSlugForUpdate(
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
        return { kind: "precondition_failed" };
      }

      if (!subgraph) {
        return { kind: "not_found" };
      }

      if (subgraph.routingUrl !== request.body.routingUrl) {
        subgraph = await insertSubgraphRevisionAndSetCurrent(
          transaction,
          subgraph.id,
          subgraph.currentRevision + 1,
          request.body.routingUrl,
          now,
        );
      }

      return {
        kind: "ok",
        subgraph,
      };
    },
  );

  if (result.kind === "precondition_failed") {
    return reply.problemDetails({ status: 412 });
  }

  if (result.kind === "not_found") {
    return reply.problemDetails({ status: 404 });
  }

  reply.header("ETag", formatStrongETag(result.subgraph.id, result.subgraph.currentRevision));
  return reply.code(200).type("application/json").send(toSubgraphPayload(result.subgraph));
};
