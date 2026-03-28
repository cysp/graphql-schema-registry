import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { selectActiveGraphBySlugForUpdate } from "../database/graph-records.ts";
import { isUniqueViolation } from "../database/postgres-errors.ts";
import { insertSubgraphWithInitialRevision } from "../database/subgraph-write-helpers.ts";
import { etagSatisfiesIfMatch, formatStrongETag, parseIfMatchHeader } from "../etag.ts";
import { toSubgraphPayload } from "./payloads.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

export const createSubgraphHandler: DependencyInjectedHandler<
  OperationHandlers["createSubgraph"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  if (!requireAdminUser(request, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const ifMatch = parseIfMatchHeader(request.headers["if-match"]);

  try {
    const result = await database.transaction(async (transaction) => {
      const now = new Date();

      const graph = await selectActiveGraphBySlugForUpdate(transaction, request.params.graphSlug);

      if (!etagSatisfiesIfMatch(ifMatch, graph && formatStrongETag(graph.id, graph.revision))) {
        return { kind: "precondition_failed" } as const;
      }

      if (!graph) {
        return { kind: "not_found" } as const;
      }

      const subgraph = await insertSubgraphWithInitialRevision(
        transaction,
        graph.id,
        request.body.slug,
        request.body.routingUrl,
        now,
      );

      return {
        kind: "created",
        subgraph,
      } as const;
    });

    if (result.kind === "precondition_failed") {
      return await reply.problemDetails({ status: 412 });
    }

    if (result.kind === "not_found") {
      return await reply.problemDetails({ status: 404 });
    }

    reply.header("ETag", formatStrongETag(result.subgraph.id, result.subgraph.revision));
    reply.header(
      "Location",
      `/v1/graphs/${encodeURIComponent(request.params.graphSlug)}/subgraphs/${encodeURIComponent(result.subgraph.slug)}`,
    );
    return await reply.code(201).send(toSubgraphPayload(result.subgraph));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return reply.problemDetails({ status: 409 });
    }

    throw error;
  }
};
