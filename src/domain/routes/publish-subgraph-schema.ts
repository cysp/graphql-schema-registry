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
  insertSubgraphSchemaRevisionAndSetCurrent,
  selectCurrentSubgraphSchemaRevision,
} from "../database/subgraph-schemas/repository.ts";
import { selectActiveSubgraphByGraphIdAndSlugForUpdate } from "../database/subgraphs/repository.ts";
import { etagSatisfiesIfMatch, formatStrongETag, parseIfMatchHeader } from "../etag.ts";
import { hashNormalizedSchemaSdl, normalizeSchemaSdl } from "../subgraph-schema.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

type PublishTransactionResult =
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "precondition_failed" }
  | { kind: "ok"; etag: string };

export const publishSubgraphSchemaHandler: DependencyInjectedHandler<
  OperationHandlers["publishSubgraphSchema"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  const user = requireAuthenticatedUser(request, reply);
  if (!user) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  let normalizedSdl: string;
  try {
    normalizedSdl = normalizeSchemaSdl(request.body);
  } catch (error) {
    request.log.warn({ error }, "invalid subgraph schema");
    return reply.problemDetails({ status: 422 });
  }

  const ifMatch = parseIfMatchHeader(request.headers["if-match"]);
  const normalizedHash = hashNormalizedSchemaSdl(normalizedSdl);

  const result: PublishTransactionResult = await database.transaction(async (transaction) => {
    const graph = await selectActiveGraphBySlugForUpdate(transaction, request.params.graphSlug);
    if (!graph) {
      if (!etagSatisfiesIfMatch(ifMatch, undefined)) {
        return { kind: "precondition_failed" };
      }

      return { kind: "not_found" };
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

      return { kind: "not_found" };
    }

    if (!hasSubgraphSchemaWriteGrant(user, graph.id, subgraph.id)) {
      return { kind: "forbidden" };
    }

    const currentSchemaRevision = await selectCurrentSubgraphSchemaRevision(
      transaction,
      subgraph.id,
    );
    const currentEtag = currentSchemaRevision
      ? formatStrongETag(subgraph.id, currentSchemaRevision.revision)
      : undefined;

    if (!etagSatisfiesIfMatch(ifMatch, currentEtag)) {
      return { kind: "precondition_failed" };
    }

    if (currentSchemaRevision?.normalizedHash === normalizedHash) {
      return {
        kind: "ok",
        etag: formatStrongETag(subgraph.id, currentSchemaRevision.revision),
      };
    }

    const nextRevision = (currentSchemaRevision?.revision ?? 0) + 1;
    const storedRevision = await insertSubgraphSchemaRevisionAndSetCurrent(transaction, {
      createdAt: new Date(),
      normalizedHash,
      normalizedSdl,
      revision: nextRevision,
      subgraphId: subgraph.id,
    });

    return {
      kind: "ok",
      etag: formatStrongETag(subgraph.id, storedRevision.revision),
    };
  });

  if (result.kind === "forbidden") {
    return reply.problemDetails({ status: 403 });
  }

  if (result.kind === "precondition_failed") {
    return reply.problemDetails({ status: 412 });
  }

  if (result.kind === "not_found") {
    return reply.problemDetails({ status: 404 });
  }

  reply.header("ETag", result.etag);
  return reply.code(204).send();
};
