import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import type { RouteHandlers } from "../openapi-ts/fastify.gen.ts";
import { getActiveGraphBySlug, listActiveGraphs } from "./graph-database.ts";
import { toGraphResponse } from "./graph-response.ts";

export function createListGraphsHandler({
  database,
}: {
  database?: PostgresJsDatabase | undefined;
}): RouteHandlers["listGraphs"] {
  return async (_request, reply) => {
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
  };
}

export function createGetGraphHandler({
  database,
}: {
  database?: PostgresJsDatabase | undefined;
}): RouteHandlers["getGraph"] {
  return async (request, reply) => {
    const user = request.user;
    if (!user) {
      reply.unauthorized();
      return;
    }

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
  };
}
