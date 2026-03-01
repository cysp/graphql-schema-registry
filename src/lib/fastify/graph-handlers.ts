import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAuthenticatedUser, requireAdminUser } from "./authorization/guards.ts";
import type { RouteHandlers } from "../openapi-ts/fastify.gen.ts";
import { getActiveGraphBySlug, listActiveGraphs } from "./graph-database.ts";
import { toGraphResponse } from "./graph-response.ts";
import {
  type DependencyInjectedHandlerContext,
  fastifyHandlerWithDependencies,
} from "./handler-with-dependencies.ts";

type GraphHandlerDependencies = {
  database?: PostgresJsDatabase | undefined;
};

async function listGraphsHandler({
  deps,
  reply,
  request,
}: DependencyInjectedHandlerContext<RouteHandlers["listGraphs"], GraphHandlerDependencies>) {
  if (!requireAdminUser(request, reply)) {
    return;
  }

  const { database } = deps;
  if (!database) {
    reply.serviceUnavailable("Database is not configured.");
    return;
  }

  const activeGraphs = await listActiveGraphs(database);

  const graphResponses = [];
  for (const graph of activeGraphs) {
    if (!graph.currentRevision) {
      reply.internalServerError("Graph is missing a current revision.");
      return;
    }

    graphResponses.push(
      toGraphResponse({
        createdAt: graph.createdAt,
        externalId: graph.externalId,
        federationVersion: graph.currentRevision.federationVersion,
        id: graph.id,
        revisionId: graph.currentRevision.revisionId,
        slug: graph.slug,
        updatedAt: graph.updatedAt,
      }),
    );
  }

  reply.code(200).send(graphResponses);
}

async function getGraphHandler({
  deps,
  reply,
  request,
}: DependencyInjectedHandlerContext<RouteHandlers["getGraph"], GraphHandlerDependencies>) {
  const user = requireAuthenticatedUser(request, reply);
  if (!user) {
    return;
  }

  const { database } = deps;
  if (!database) {
    reply.serviceUnavailable("Database is not configured.");
    return;
  }

  const activeGraph = await getActiveGraphBySlug(database, request.params.graphSlug);

  if (!activeGraph) {
    reply.notFound("Graph not found.");
    return;
  }

  const canReadGraph = user.grants.some(
    (grant) =>
      grant.scope === "admin" ||
      (grant.scope === "graph:read" && grant.graphId === activeGraph.externalId),
  );

  if (!canReadGraph) {
    reply.forbidden();
    return;
  }

  if (!activeGraph.currentRevision) {
    reply.internalServerError("Graph is missing a current revision.");
    return;
  }

  reply.code(200).send(
    toGraphResponse({
      createdAt: activeGraph.createdAt,
      externalId: activeGraph.externalId,
      federationVersion: activeGraph.currentRevision.federationVersion,
      id: activeGraph.id,
      revisionId: activeGraph.currentRevision.revisionId,
      slug: activeGraph.slug,
      updatedAt: activeGraph.updatedAt,
    }),
  );
}

export function createListGraphsHandler({
  database,
}: {
  database?: PostgresJsDatabase | undefined;
}): RouteHandlers["listGraphs"] {
  return fastifyHandlerWithDependencies<RouteHandlers["listGraphs"], GraphHandlerDependencies>(
    { database },
    listGraphsHandler,
  );
}

export function createGetGraphHandler({
  database,
}: {
  database?: PostgresJsDatabase | undefined;
}): RouteHandlers["getGraph"] {
  return fastifyHandlerWithDependencies<RouteHandlers["getGraph"], GraphHandlerDependencies>(
    { database },
    getGraphHandler,
  );
}
