import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { assertNever } from "../../lib/assert-never.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import {
  selectActiveSubgraphByGraphSlugAndSubgraphSlug,
  selectActiveSubgraphsByGraphSlug,
} from "../database/subgraph-records.ts";
import {
  createSubgraph,
  deleteSubgraphBySlugs,
  updateSubgraphBySlugs,
} from "../database/subgraphs.ts";
import { parseIfMatchHeader } from "../etag.ts";
import {
  sendCreatedSubgraphResponse,
  sendSubgraphResponse,
  toSubgraphPayload,
} from "./payloads.ts";

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

export const deleteSubgraphHandler: DependencyInjectedHandler<
  OperationHandlers["deleteSubgraph"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  if (!requireAdminUser(request, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const result = await deleteSubgraphBySlugs(database, {
    graphSlug: request.params.graphSlug,
    subgraphSlug: request.params.subgraphSlug,
    ifMatch: parseIfMatchHeader(request.headers["if-match"]),
    now: new Date(),
  });

  switch (result.kind) {
    case "precondition_failed":
      return reply.problemDetails({ status: 412 });
    case "no_content":
      return reply.code(204).send();
    default:
      return assertNever(result);
  }
};

export const getSubgraphHandler: DependencyInjectedHandler<
  OperationHandlers["getSubgraph"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  if (!requireAdminUser(request, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const subgraph = await selectActiveSubgraphByGraphSlugAndSubgraphSlug(
    database,
    request.params.graphSlug,
    request.params.subgraphSlug,
  );
  if (!subgraph) {
    return reply.problemDetails({ status: 404 });
  }

  return sendSubgraphResponse(reply, subgraph);
};

export const listSubgraphsHandler: DependencyInjectedHandler<
  OperationHandlers["listSubgraphs"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  if (!requireAdminUser(request, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const subgraphs = await selectActiveSubgraphsByGraphSlug(database, request.params.graphSlug);
  if (subgraphs === undefined) {
    return reply.problemDetails({ status: 404 });
  }

  return reply.code(200).send(subgraphs.map((subgraph) => toSubgraphPayload(subgraph)));
};

export const updateSubgraphHandler: DependencyInjectedHandler<
  OperationHandlers["updateSubgraph"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  if (!requireAdminUser(request, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const result = await updateSubgraphBySlugs(database, {
    graphSlug: request.params.graphSlug,
    subgraphSlug: request.params.subgraphSlug,
    ifMatch: parseIfMatchHeader(request.headers["if-match"]),
    routingUrl: request.body.routingUrl,
    now: new Date(),
  });

  switch (result.kind) {
    case "not_found":
      return reply.problemDetails({ status: 404 });
    case "precondition_failed":
      return reply.problemDetails({ status: 412 });
    case "ok":
      return sendSubgraphResponse(reply, result.subgraph);
    default:
      return assertNever(result);
  }
};
