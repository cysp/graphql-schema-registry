import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import type { RouteHandlers } from "../openapi-ts/fastify.gen.ts";
import { getGraphBySlug, listGraphs } from "./graph-database.ts";
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

    const rows = await listGraphs(database);

    const responsePayload = [];
    for (const graph of rows) {
      if (!graph.currentRevision) {
        reply.internalServerError("Graph is missing a current revision.");
        return;
      }

      responsePayload.push(
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

    reply.code(200).send(responsePayload);
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

    const graph = await getGraphBySlug(database, request.params.graphSlug);

    if (!graph) {
      reply.notFound("Graph not found.");
      return;
    }

    const canReadGraph = user.grants.some(
      (grant) =>
        grant.scope === "admin" ||
        (grant.scope === "graph:read" && grant.graphId === graph.externalId),
    );

    if (!canReadGraph) {
      reply.forbidden();
      return;
    }

    if (!graph.currentRevision) {
      reply.internalServerError("Graph is missing a current revision.");
      return;
    }

    reply.code(200).send(
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
  };
}
