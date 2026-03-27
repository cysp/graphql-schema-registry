import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { assertNever } from "../../lib/assert-never.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { updateGraphBySlug } from "../database/graphs.ts";
import { parseIfMatchHeader } from "../etag.ts";
import { sendGraphResponse } from "./payloads.ts";

type OperationHandlers = OpenApiOperationHandlers<
  keyof typeof operationRouteDefinitions,
  typeof operationRouteDefinitions
>;

type RouteDependencies = {
  database: PostgresJsDatabase | undefined;
};

export const updateGraphHandler: DependencyInjectedHandler<
  OperationHandlers["updateGraph"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  if (!requireAdminUser(request, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const result = await updateGraphBySlug(database, {
    slug: request.params.graphSlug,
    ifMatch: parseIfMatchHeader(request.headers["if-match"]),
    federationVersion: request.body.federationVersion,
    now: new Date(),
  });

  switch (result.kind) {
    case "not_found":
      return reply.problemDetails({ status: 404 });
    case "precondition_failed":
      return reply.problemDetails({ status: 412 });
    case "ok":
      return sendGraphResponse(reply, result.graph);
    default:
      return assertNever(result);
  }
};
