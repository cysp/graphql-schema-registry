import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import {
  hasSubgraphSchemaWriteGrant,
  requireAuthenticatedUser,
} from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { selectActiveGraphBySlugForUpdate } from "../database/graphs/repository.ts";
import {
  clearCurrentSubgraphSchemaRevision,
  selectCurrentSubgraphSchemaRevision,
} from "../database/subgraph-schemas/repository.ts";
import { selectActiveSubgraphByGraphIdAndSlugForUpdate } from "../database/subgraphs/repository.ts";
import { etagSatisfiesIfMatch, formatStrongETag, parseIfMatchHeader } from "../etag.ts";
import { attemptGraphComposition } from "../graph-composition.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

type DeleteTransactionResult =
  | { kind: "forbidden" }
  | { kind: "precondition_failed" }
  | { kind: "no_content" };

export const deleteSubgraphSchemaHandler: DependencyInjectedHandler<
  OperationHandlers["deleteSubgraphSchema"],
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

  const result: DeleteTransactionResult = await database.transaction(async (transaction) => {
    const now = new Date();

    const graph = await selectActiveGraphBySlugForUpdate(transaction, request.params.graphSlug);
    if (!graph) {
      if (!etagSatisfiesIfMatch(ifMatch, undefined)) {
        return { kind: "precondition_failed" };
      }

      return { kind: "no_content" };
    }

    const subgraph = await selectActiveSubgraphByGraphIdAndSlugForUpdate(
      transaction,
      graph.id,
      request.params.subgraphSlug,
    );
    if (!subgraph) {
      if (!etagSatisfiesIfMatch(ifMatch, undefined)) {
        return { kind: "precondition_failed" };
      }

      return { kind: "no_content" };
    }

    if (!hasSubgraphSchemaWriteGrant(user, graph.id, subgraph.id)) {
      return { kind: "forbidden" };
    }

    const currentSchemaRevision = await selectCurrentSubgraphSchemaRevision(
      transaction,
      subgraph.id,
    );
    const currentEtag =
      currentSchemaRevision && formatStrongETag(subgraph.id, currentSchemaRevision.revision);

    if (!etagSatisfiesIfMatch(ifMatch, currentEtag)) {
      return { kind: "precondition_failed" };
    }

    if (!currentSchemaRevision) {
      return { kind: "no_content" };
    }

    await clearCurrentSubgraphSchemaRevision(transaction, subgraph.id);

    await attemptGraphComposition(transaction, graph, now);

    return { kind: "no_content" };
  });

  if (result.kind === "forbidden") {
    return reply.problemDetails({ status: 403 });
  }

  if (result.kind === "precondition_failed") {
    return reply.problemDetails({ status: 412 });
  }

  return reply.code(204).send();
};
