import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAuthenticatedUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { canCreateGraph } from "../authorization/policy.ts";
import { insertGraphWithInitialRevision } from "../database/graphs/repository.ts";
import { isUniqueViolation } from "../database/postgres-errors.ts";
import { formatStrongETag } from "../etag.ts";
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
  const user = requireAuthenticatedUser(request, reply);
  if (!user) {
    return;
  }

  if (!canCreateGraph(user.grants)) {
    reply.problemDetails({ status: 403 });
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  try {
    const graph = await database.transaction(async (transaction) => {
      const now = new Date();

      return insertGraphWithInitialRevision(transaction, request.body.slug, now);
    });

    reply.header("ETag", formatStrongETag(graph.id, graph.currentRevision));
    reply.header("Location", `/v1/graphs/${encodeURIComponent(graph.slug)}`);
    return await reply.code(201).send(toGraphPayload(graph));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return reply.problemDetails({ status: 409 });
    }

    throw error;
  }
};
