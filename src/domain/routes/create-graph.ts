import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminGrant } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { insertGraphWithInitialRevision } from "../database/graphs/repository.ts";
import { isUniqueViolation } from "../database/postgres-errors.ts";
import { formatStrongETag } from "../etag.ts";
import { composeGraphWithinTransaction } from "../supergraph-composition.ts";
import { logCompositionFailure } from "./log-composition-failure.ts";
import { toGraphPayload } from "./payloads.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

export const createGraphHandler: DependencyInjectedHandler<
  OperationHandlers["createGraph"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  if (!requireAdminGrant(request, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  try {
    const result = await database.transaction(async (transaction) => {
      const now = new Date();

      const graph = await insertGraphWithInitialRevision(transaction, request.body.slug, now);

      const composition = await composeGraphWithinTransaction(transaction, graph, now);

      return {
        composition,
        graph,
      };
    });

    logCompositionFailure(request.log, { graphId: result.graph.id }, result.composition);

    reply.header("ETag", formatStrongETag(result.graph.id, result.graph.currentRevision));
    reply.header("Location", `/v1/graphs/${encodeURIComponent(result.graph.slug)}`);
    return await reply.code(201).send(toGraphPayload(result.graph));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return reply.problemDetails({ status: 409 });
    }

    throw error;
  }
};
