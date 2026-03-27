import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { assertNever } from "../../lib/assert-never.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { createSubgraph } from "../database/subgraphs.ts";
import { parseIfMatchHeader } from "../etag.ts";
import { sendCreatedSubgraphResponse } from "./payloads.ts";

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

  const result = await createSubgraph(database, {
    graphSlug: request.params.graphSlug,
    slug: request.body.slug,
    ifMatch: parseIfMatchHeader(request.headers["if-match"]),
    routingUrl: request.body.routingUrl,
    now: new Date(),
  });

  switch (result.kind) {
    case "precondition_failed":
      return reply.problemDetails({ status: 412 });
    case "not_found":
      return reply.problemDetails({ status: 404 });
    case "conflict":
      return reply.problemDetails({ status: 409 });
    case "created":
      return sendCreatedSubgraphResponse(reply, request.params.graphSlug, result.subgraph);
    default:
      return assertNever(result);
  }
};
