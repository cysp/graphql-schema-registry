import { subgraphSchemaRevisions } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { assertNever } from "../../lib/assert-never.ts";
import {
  hasSubgraphWriteGrant,
  requireAuthenticatedUser,
} from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { attemptGraphComposition } from "../composition/attempt-graph-composition.ts";
import { selectActiveGraphBySlugForUpdate } from "../database/graphs/repository.ts";
import { selectCurrentSchemaRevision } from "../database/subgraph-schemas.ts";
import { selectActiveSubgraphByGraphIdAndSlugForUpdate } from "../database/subgraphs/repository.ts";
import { etagSatisfiesIfMatch, formatStrongETag, parseIfMatchHeader } from "../etag.ts";
import { validateSubgraphSchema } from "../federation.ts";
import { toPublishSubgraphSchemaPayload } from "./payloads.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

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

  const ifMatch = parseIfMatchHeader(request.headers["if-match"]);

  const result = await database.transaction(async (transaction) => {
    const now = new Date();

    const graph = await selectActiveGraphBySlugForUpdate(transaction, request.params.graphSlug);
    if (!graph) {
      if (!etagSatisfiesIfMatch(ifMatch, undefined)) {
        return { kind: "precondition_failed" } as const;
      }

      return { kind: "not_found" } as const;
    }

    let subgraph = await selectActiveSubgraphByGraphIdAndSlugForUpdate(
      transaction,
      graph.id,
      request.params.subgraphSlug,
    );

    if (
      !etagSatisfiesIfMatch(ifMatch, subgraph && formatStrongETag(subgraph.id, subgraph.revision))
    ) {
      return { kind: "precondition_failed" } as const;
    }

    if (!subgraph) {
      return { kind: "not_found" } as const;
    }

    if (!hasSubgraphWriteGrant(user, graph.id, subgraph.id)) {
      return { kind: "unauthorized" } as const;
    }

    const validatedSchema = validateSubgraphSchema(
      subgraph.slug,
      subgraph.routingUrl,
      request.body,
    );
    if (!validatedSchema.ok) {
      return {
        kind: "unprocessable_entity",
      } as const;
    }

    const currentSchema = await selectCurrentSchemaRevision(transaction, subgraph.id);

    if (currentSchema?.normalizedHash === validatedSchema.value.normalizedHash) {
      return {
        kind: "noop",
        revision: currentSchema.revision,
      } as const;
    }

    const nextRevision = (currentSchema?.revision ?? 0) + 1;
    await transaction.insert(subgraphSchemaRevisions).values({
      createdAt: now,
      normalizedHash: validatedSchema.value.normalizedHash,
      normalizedSdl: validatedSchema.value.normalizedSdl,
      revision: nextRevision,
      subgraphId: subgraph.id,
    });

    await attemptGraphComposition(transaction, graph.id, now);

    return {
      kind: "published",
      revision: nextRevision,
    } as const;
  });

  switch (result.kind) {
    case "unauthorized":
      return reply.problemDetails({ status: 401 });
    case "not_found":
      return reply.problemDetails({ status: 404 });
    case "precondition_failed":
      return reply.problemDetails({ status: 412 });
    case "unprocessable_entity":
      return reply.problemDetails({ status: 422 });
    case "noop":
      return reply.code(200).send(toPublishSubgraphSchemaPayload(result.revision));
    case "published":
      return reply.code(201).send(toPublishSubgraphSchemaPayload(result.revision));
    default:
      return assertNever(result);
  }
};
