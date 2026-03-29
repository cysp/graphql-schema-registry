import type { FastifyReply } from "fastify";

import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { attemptGraphComposition } from "../composition/attempt-graph-composition.ts";
import { insertGraphWithInitialRevision } from "../database/graphs/repository.ts";
import { isUniqueViolation } from "../database/postgres-errors.ts";
import { formatStrongETag } from "../etag.ts";
import { isSupportedFederationVersion } from "../federation.ts";
import { toGraphPayload } from "./payloads.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

function requireSupportedFederationVersion(
  federationVersion: string,
  reply: FastifyReply,
): boolean {
  if (!isSupportedFederationVersion(federationVersion)) {
    reply.problemDetails({ status: 422 });
    return false;
  }

  return true;
}

export const createGraphHandler: DependencyInjectedHandler<
  OperationHandlers["createGraph"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  if (!requireAdminUser(request, reply)) {
    return;
  }

  if (!requireSupportedFederationVersion(request.body.federationVersion, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  try {
    const graph = await database.transaction(async (transaction) => {
      const now = new Date();

      const graph = await insertGraphWithInitialRevision(
        transaction,
        request.body.slug,
        request.body.federationVersion,
        now,
      );

      await attemptGraphComposition(transaction, graph.id, now);

      return graph;
    });

    reply.header("ETag", formatStrongETag(graph.id, graph.revision));
    reply.header("Location", `/v1/graphs/${encodeURIComponent(graph.slug)}`);
    return await reply.code(201).send(toGraphPayload(graph));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return reply.problemDetails({ status: 409 });
    }

    throw error;
  }
};
