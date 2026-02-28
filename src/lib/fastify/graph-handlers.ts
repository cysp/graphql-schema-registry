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

    reply.code(200).send(
      rows.map((graph) =>
        toGraphResponse({
          createdAt: graph.createdAt,
          externalId: graph.externalId,
          federationVersion: graph.revisions[0]?.federationVersion ?? graph.federationVersion,
          id: graph.id,
          revisionId: graph.revisions[0]?.revisionId ?? graph.revisionId,
          slug: graph.slug,
          updatedAt: graph.updatedAt,
        }),
      ),
    );
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

    reply.code(200).send(
      toGraphResponse({
        createdAt: graph.createdAt,
        externalId: graph.externalId,
        federationVersion: graph.revisions[0]?.federationVersion ?? graph.federationVersion,
        id: graph.id,
        revisionId: graph.revisions[0]?.revisionId ?? graph.revisionId,
        slug: graph.slug,
        updatedAt: graph.updatedAt,
      }),
    );
  };
}
