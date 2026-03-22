import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { assertNever } from "../../lib/assert-never.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandler } from "../../lib/fastify/handler-with-dependencies.ts";
import type { operationRouteDefinitions } from "../../lib/fastify/openapi/generated/operations/index.ts";
import type { OpenApiOperationHandlers } from "../../lib/fastify/openapi/plugin.ts";
import { requireDatabase } from "../../lib/fastify/require-database.ts";
import { selectActiveGraphBySlug, selectActiveGraphs } from "../database/graph-records.ts";
import { createGraph, deleteGraphBySlug, updateGraphBySlug } from "../database/graphs.ts";
import { parseIfMatchHeader } from "../etag.ts";
import { sendCreatedGraphResponse, sendGraphResponse, toGraphPayload } from "./payloads.ts";

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
  if (!requireAdminUser(request, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const result = await createGraph(database, {
    slug: request.body.slug,
    federationVersion: request.body.federationVersion,
    now: new Date(),
  });

  switch (result.kind) {
    case "conflict":
      return reply.problemDetails({ status: 409 });
    case "created":
      return sendCreatedGraphResponse(reply, result.graph);
    default:
      return assertNever(result);
  }
};

export const deleteGraphHandler: DependencyInjectedHandler<
  OperationHandlers["deleteGraph"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  if (!requireAdminUser(request, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const result = await deleteGraphBySlug(database, {
    slug: request.params.graphSlug,
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

export const getGraphHandler: DependencyInjectedHandler<
  OperationHandlers["getGraph"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  if (!requireAdminUser(request, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const graph = await selectActiveGraphBySlug(database, request.params.graphSlug);
  if (!graph) {
    return reply.problemDetails({ status: 404 });
  }

  return sendGraphResponse(reply, graph);
};

export const listGraphsHandler: DependencyInjectedHandler<
  OperationHandlers["listGraphs"],
  RouteDependencies
> = async ({ dependencies: { database }, request, reply }) => {
  if (!requireAdminUser(request, reply)) {
    return;
  }

  if (!requireDatabase(database, reply)) {
    return;
  }

  const graphs = await selectActiveGraphs(database);
  return reply.code(200).send(graphs.map((graph) => toGraphPayload(graph)));
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
