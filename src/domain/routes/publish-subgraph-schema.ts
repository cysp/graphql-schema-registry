import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAuthenticatedUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { canWriteSubgraphSchema } from "../authorization/policy.ts";
import { selectActiveGraphBySlugForUpdate } from "../database/graphs/repository.ts";
import {
  insertSubgraphSchemaRevisionAndSetCurrent,
  selectCurrentSubgraphSchemaRevision,
  selectLatestSubgraphSchemaRevision,
} from "../database/subgraph-schemas/repository.ts";
import { selectActiveSubgraphByGraphIdAndSlugForUpdate } from "../database/subgraphs/repository.ts";
import { etagSatisfiesIfMatch, formatStrongETag, parseIfMatchHeader } from "../etag.ts";
import { attemptGraphComposition } from "../graph-composition.ts";
import { normalizeSchemaSdl, sha256NormalizedSchemaSdl } from "../subgraph-schema.ts";

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
  const normalizedSdlSha256 = sha256NormalizedSchemaSdl(normalizedSdl);

  const result: PublishTransactionResult = await database.transaction(async (transaction) => {
    const now = new Date();

    const graph = await selectActiveGraphBySlugForUpdate(transaction, request.params.graphSlug);
    let subgraph;
    if (graph) {
      subgraph = await selectActiveSubgraphByGraphIdAndSlugForUpdate(
        transaction,
        graph.id,
        request.params.subgraphSlug,
      );
    }

    if (!canWriteSubgraphSchema(user.grants, graph?.id ?? "*", subgraph?.id ?? "*")) {
      return { kind: "forbidden" };
    }

    if (!graph || !subgraph) {
      if (!etagSatisfiesIfMatch(ifMatch, undefined)) {
        return { kind: "precondition_failed" };
      }

      return { kind: "not_found" };
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

    if (currentSchemaRevision?.normalizedSdlSha256.equals(normalizedSdlSha256)) {
      return {
        kind: "ok",
        etag: formatStrongETag(subgraph.id, currentSchemaRevision.revision),
      };
    }

    const latestSchemaRevision =
      currentSchemaRevision ?? (await selectLatestSubgraphSchemaRevision(transaction, subgraph.id));
    const nextRevision = (latestSchemaRevision?.revision ?? 0n) + 1n;
    const storedRevision = await insertSubgraphSchemaRevisionAndSetCurrent(transaction, {
      createdAt: now,
      normalizedSdl,
      revision: nextRevision,
      subgraphId: subgraph.id,
    });

    await attemptGraphComposition(transaction, graph, now);

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
