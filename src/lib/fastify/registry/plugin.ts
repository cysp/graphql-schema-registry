// oxlint-disable eslint/max-lines

import { and, eq, isNull, sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import fastifyPlugin from "fastify-plugin";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { graphRevisions, graphs, subgraphRevisions, subgraphs } from "../../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../../drizzle/types.ts";
import type {
  DeleteGraphData,
  DeleteSubgraphData,
  GetGraphData,
  GetSubgraphData,
  ListSubgraphsData,
  UpsertGraphData,
  UpsertSubgraphData,
} from "../../openapi-ts/types.gen.ts";
import {
  zGetGraphData,
  zGetGraphResponse,
  zGetSubgraphData,
  zGetSubgraphResponse,
  zListGraphsResponse,
  zListSubgraphsData,
  zListSubgraphsResponse,
  zUpsertGraphData,
  zUpsertGraphResponse,
  zUpsertSubgraphData,
  zUpsertSubgraphResponse,
  zXRevision,
} from "../../openapi-ts/zod.gen.ts";
import { requireAdmin } from "../authorization/guards.ts";

type RegistryPluginOptions = {
  database?: PostgresJsDatabase | undefined;
};

type GraphRow = typeof graphs.$inferSelect;
type SubgraphRow = typeof subgraphs.$inferSelect;
const graphParamsSchema = zGetGraphData.shape.path;
const subgraphParamsSchema = zGetSubgraphData.shape.path;
const upsertGraphBodySchema = zUpsertGraphData.shape.body;
const upsertSubgraphBodySchema = zUpsertSubgraphData.shape.body;
const graphSchema = zGetGraphResponse;
const subgraphSchema = zGetSubgraphResponse;
const graphListSchema = zListGraphsResponse;
const subgraphListSchema = zListSubgraphsResponse;
const upsertGraphResponseSchema = zUpsertGraphResponse;
const upsertSubgraphResponseSchema = zUpsertSubgraphResponse;

function sendNotImplemented(_request: FastifyRequest, reply: FastifyReply): void {
  reply.code(501).send();
}

function getDatabase(
  database: PostgresJsDatabase | undefined,
  reply: FastifyReply,
): PostgresJsDatabase | undefined {
  if (database) {
    return database;
  }

  reply.serviceUnavailable("Database is not configured.");
  return undefined;
}

function mapGraphRowToResponse(graph: GraphRow) {
  return {
    id: graph.externalId,
    slug: graph.slug,
    revisionId: graph.revisionId,
    federationVersion: graph.federationVersion,
    createdAt: graph.createdAt.toISOString(),
    updatedAt: graph.updatedAt.toISOString(),
  };
}

function mapSubgraphRowToResponse(subgraph: SubgraphRow, graphExternalId: string) {
  return {
    id: subgraph.externalId,
    slug: subgraph.slug,
    graphId: graphExternalId,
    revisionId: subgraph.revisionId,
    routingUrl: subgraph.routingUrl,
    createdAt: subgraph.createdAt.toISOString(),
    updatedAt: subgraph.updatedAt.toISOString(),
  };
}

async function getActiveGraphBySlug(
  database: Pick<PostgresJsDatabase, "select">,
  slug: string,
): Promise<GraphRow | undefined> {
  const rows = await database
    .select()
    .from(graphs)
    .where(and(eq(graphs.slug, slug), isNull(graphs.deletedAt)))
    .limit(1);

  return rows[0];
}

async function getActiveSubgraphBySlug(
  database: Pick<PostgresJsDatabase, "select">,
  graphId: number,
  slug: string,
): Promise<SubgraphRow | undefined> {
  const rows = await database
    .select()
    .from(subgraphs)
    .where(
      and(eq(subgraphs.graphId, graphId), eq(subgraphs.slug, slug), isNull(subgraphs.deletedAt)),
    )
    .limit(1);

  return rows[0];
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "23505",
  );
}

function parseExpectedRevisionHeader(value: unknown): number | undefined {
  let parsedValue: unknown = value;
  if (typeof value === "string") {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
      return undefined;
    }

    parsedValue = Number(value);
  }

  const parsed = zXRevision.safeParse(parsedValue);
  if (!parsed.success) {
    return undefined;
  }

  const revision = parsed.data;

  if (typeof revision === "number") {
    if (Number.isSafeInteger(revision) && revision >= 0) {
      return revision;
    }

    return undefined;
  }

  if (typeof revision !== "bigint") {
    return undefined;
  }

  if (revision > BigInt(Number.MAX_SAFE_INTEGER)) {
    return undefined;
  }

  return Number(revision);
}

async function requireGraphReadScope(
  request: FastifyRequest<{ Params: GetGraphData["path"] }>,
  reply: FastifyReply,
  database: PostgresJsDatabase | undefined,
): Promise<boolean> {
  if (!request.user) {
    reply.unauthorized();
    return false;
  }

  const graphReadGrants = request.user.grants.filter((grant) => grant.scope === "graph:read");
  if (graphReadGrants.length === 0) {
    reply.forbidden();
    return false;
  }

  const db = getDatabase(database, reply);
  if (!db) {
    return false;
  }

  const graph = await getActiveGraphBySlug(db, request.params.graphSlug);
  if (!graph) {
    reply.notFound();
    return false;
  }

  const isAuthorized = graphReadGrants.some((grant) => grant.graphId === graph.externalId);
  if (!isAuthorized) {
    reply.forbidden();
    return false;
  }

  return true;
}

async function requireSubgraphWriteScope(
  request: FastifyRequest<{ Params: GetSubgraphData["path"] }>,
  reply: FastifyReply,
  database: PostgresJsDatabase | undefined,
): Promise<boolean> {
  if (!request.user) {
    reply.unauthorized();
    return false;
  }

  const subgraphWriteGrants = request.user.grants.filter(
    (grant) => grant.scope === "subgraph:write",
  );
  if (subgraphWriteGrants.length === 0) {
    reply.forbidden();
    return false;
  }

  const db = getDatabase(database, reply);
  if (!db) {
    return false;
  }

  const graph = await getActiveGraphBySlug(db, request.params.graphSlug);
  if (!graph) {
    reply.notFound();
    return false;
  }

  const subgraph = await getActiveSubgraphBySlug(db, graph.id, request.params.subgraphSlug);
  if (!subgraph) {
    reply.notFound();
    return false;
  }

  const isAuthorized = subgraphWriteGrants.some(
    (grant) => grant.graphId === graph.externalId && grant.subgraphId === subgraph.externalId,
  );
  if (!isAuthorized) {
    reply.forbidden();
    return false;
  }

  return true;
}

const registryPluginImpl: FastifyPluginCallbackZod<RegistryPluginOptions> = (
  server,
  options,
  done,
): void => {
  server.get(
    "/v1/graphs",
    {
      preHandler: requireAdmin,
      schema: {
        response: {
          200: graphListSchema,
        },
      },
    },
    async (_request, reply) => {
      const db = getDatabase(options.database, reply);
      if (!db) {
        return;
      }

      const rows = await db
        .select()
        .from(graphs)
        .where(isNull(graphs.deletedAt))
        .orderBy(graphs.slug);

      return { items: rows.map((row) => mapGraphRowToResponse(row)) };
    },
  );

  server.get(
    "/v1/graphs/:graphSlug",
    {
      preHandler: requireAdmin,
      schema: {
        params: graphParamsSchema,
        response: {
          200: graphSchema,
        },
      },
    },
    async (request: FastifyRequest<{ Params: GetGraphData["path"] }>, reply) => {
      const db = getDatabase(options.database, reply);
      if (!db) {
        return;
      }

      const graph = await getActiveGraphBySlug(db, request.params.graphSlug);
      if (!graph) {
        reply.notFound();
        return;
      }

      return mapGraphRowToResponse(graph);
    },
  );

  server.delete(
    "/v1/graphs/:graphSlug",
    {
      preHandler: requireAdmin,
      schema: {
        params: graphParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: DeleteGraphData["path"] }>, reply) => {
      const db = getDatabase(options.database, reply);
      if (!db) {
        return;
      }

      const now = new Date();
      const result = await db.transaction(async (tx) => {
        const rows = await tx
          .update(graphs)
          .set({
            deletedAt: now,
            updatedAt: now,
          })
          .where(and(eq(graphs.slug, request.params.graphSlug), isNull(graphs.deletedAt)))
          .returning();

        const deletedGraph = rows[0];
        if (!deletedGraph) {
          return;
        }

        await tx
          .update(subgraphs)
          .set({
            deletedAt: now,
            updatedAt: now,
          })
          .where(and(eq(subgraphs.graphId, deletedGraph.id), isNull(subgraphs.deletedAt)));

        return deletedGraph;
      });

      if (!result) {
        reply.notFound();
        return;
      }

      reply.code(204).send();
    },
  );

  server.put(
    "/v1/graphs/:graphSlug",
    {
      preHandler: requireAdmin,
      schema: {
        params: graphParamsSchema,
        body: upsertGraphBodySchema,
        response: {
          200: upsertGraphResponseSchema,
          201: upsertGraphResponseSchema,
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: UpsertGraphData["body"]; Params: UpsertGraphData["path"] }>,
      reply,
    ) => {
      const expectedRevision = parseExpectedRevisionHeader(
        (request.headers as Record<string, unknown>)["x-revision"] ??
          (request.headers as Record<string, unknown>)["X-Revision"],
      );
      if (expectedRevision === undefined) {
        reply.unprocessableEntity("Invalid X-Revision header.");
        return;
      }

      const db = getDatabase(options.database, reply);
      if (!db) {
        return;
      }

      const graphSlug = request.params.graphSlug;
      const federationVersion = request.body.federationVersion;
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        const existing = await getActiveGraphBySlug(tx, graphSlug);
        if (existing) {
          if (existing.revisionId !== expectedRevision) {
            return { kind: "conflict" as const, detail: "Revision mismatch." };
          }

          if (existing.federationVersion === federationVersion) {
            return { kind: "success" as const, graph: existing, statusCode: 200 as const };
          }

          const updatedRows = await tx
            .update(graphs)
            .set({
              federationVersion,
              revisionId: sql`${graphs.revisionId} + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(graphs.id, existing.id),
                eq(graphs.revisionId, expectedRevision),
                isNull(graphs.deletedAt),
              ),
            )
            .returning();

          const updated = updatedRows[0];
          if (!updated) {
            return { kind: "conflict" as const, detail: "Revision mismatch." };
          }

          await tx.insert(graphRevisions).values({
            graphId: updated.id,
            revisionId: updated.revisionId,
            federationVersion: updated.federationVersion,
            createdAt: now,
          });

          return { kind: "success" as const, graph: updated, statusCode: 200 as const };
        }

        if (expectedRevision !== 0) {
          return {
            kind: "conflict" as const,
            detail: "X-Revision must be 0 when creating a new graph.",
          };
        }

        try {
          const createdRows = await tx
            .insert(graphs)
            .values({
              slug: graphSlug,
              federationVersion,
              revisionId: 1,
              createdAt: now,
              updatedAt: now,
            })
            .returning();

          const created = createdRows[0];
          if (!created) {
            throw new Error("Graph insert did not return a row.");
          }

          await tx.insert(graphRevisions).values({
            graphId: created.id,
            revisionId: created.revisionId,
            federationVersion: created.federationVersion,
            createdAt: now,
          });

          return { kind: "success" as const, graph: created, statusCode: 201 as const };
        } catch (error) {
          if (isUniqueViolation(error)) {
            return { kind: "conflict" as const, detail: "Graph slug is already in use." };
          }

          throw error;
        }
      });

      if (result.kind === "conflict") {
        reply.conflict(result.detail);
        return;
      }

      reply.code(result.statusCode);
      return mapGraphRowToResponse(result.graph);
    },
  );

  server.get(
    "/v1/graphs/:graphSlug/subgraphs",
    {
      preHandler: requireAdmin,
      schema: {
        params: zListSubgraphsData.shape.path,
        response: {
          200: subgraphListSchema,
        },
      },
    },
    async (request: FastifyRequest<{ Params: ListSubgraphsData["path"] }>, reply) => {
      const db = getDatabase(options.database, reply);
      if (!db) {
        return;
      }

      const graph = await getActiveGraphBySlug(db, request.params.graphSlug);
      if (!graph) {
        reply.notFound();
        return;
      }

      const rows = await db
        .select()
        .from(subgraphs)
        .where(and(eq(subgraphs.graphId, graph.id), isNull(subgraphs.deletedAt)))
        .orderBy(subgraphs.slug);

      return {
        items: rows.map((row) => mapSubgraphRowToResponse(row, graph.externalId)),
      };
    },
  );

  server.get(
    "/v1/graphs/:graphSlug/subgraphs/:subgraphSlug",
    {
      preHandler: requireAdmin,
      schema: {
        params: subgraphParamsSchema,
        response: {
          200: subgraphSchema,
        },
      },
    },
    async (request: FastifyRequest<{ Params: GetSubgraphData["path"] }>, reply) => {
      const db = getDatabase(options.database, reply);
      if (!db) {
        return;
      }

      const graph = await getActiveGraphBySlug(db, request.params.graphSlug);
      if (!graph) {
        reply.notFound();
        return;
      }

      const subgraph = await getActiveSubgraphBySlug(db, graph.id, request.params.subgraphSlug);
      if (!subgraph) {
        reply.notFound();
        return;
      }

      return mapSubgraphRowToResponse(subgraph, graph.externalId);
    },
  );

  server.delete(
    "/v1/graphs/:graphSlug/subgraphs/:subgraphSlug",
    {
      preHandler: requireAdmin,
      schema: {
        params: subgraphParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: DeleteSubgraphData["path"] }>, reply) => {
      const db = getDatabase(options.database, reply);
      if (!db) {
        return;
      }

      const graph = await getActiveGraphBySlug(db, request.params.graphSlug);
      if (!graph) {
        reply.notFound();
        return;
      }

      const now = new Date();
      const rows = await db
        .update(subgraphs)
        .set({
          deletedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(subgraphs.graphId, graph.id),
            eq(subgraphs.slug, request.params.subgraphSlug),
            isNull(subgraphs.deletedAt),
          ),
        )
        .returning();

      if (rows.length === 0) {
        reply.notFound();
        return;
      }

      reply.code(204).send();
    },
  );

  server.put(
    "/v1/graphs/:graphSlug/subgraphs/:subgraphSlug",
    {
      preHandler: requireAdmin,
      schema: {
        params: subgraphParamsSchema,
        body: upsertSubgraphBodySchema,
        response: {
          200: upsertSubgraphResponseSchema,
          201: upsertSubgraphResponseSchema,
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: UpsertSubgraphData["body"];
        Params: UpsertSubgraphData["path"];
      }>,
      reply,
    ) => {
      const expectedRevision = parseExpectedRevisionHeader(
        (request.headers as Record<string, unknown>)["x-revision"] ??
          (request.headers as Record<string, unknown>)["X-Revision"],
      );
      if (expectedRevision === undefined) {
        reply.unprocessableEntity("Invalid X-Revision header.");
        return;
      }

      const db = getDatabase(options.database, reply);
      if (!db) {
        return;
      }

      const graphSlug = request.params.graphSlug;
      const subgraphSlug = request.params.subgraphSlug;
      const routingUrl = request.body.routingUrl;
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        const graph = await getActiveGraphBySlug(tx, graphSlug);
        if (!graph) {
          return { kind: "not_found" as const, detail: "Graph not found." };
        }

        const existing = await getActiveSubgraphBySlug(tx, graph.id, subgraphSlug);
        if (existing) {
          if (existing.revisionId !== expectedRevision) {
            return { kind: "conflict" as const, detail: "Revision mismatch." };
          }

          if (existing.routingUrl === routingUrl) {
            return {
              kind: "success" as const,
              statusCode: 200 as const,
              graphExternalId: graph.externalId,
              subgraph: existing,
            };
          }

          const updatedRows = await tx
            .update(subgraphs)
            .set({
              routingUrl,
              revisionId: sql`${subgraphs.revisionId} + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(subgraphs.id, existing.id),
                eq(subgraphs.revisionId, expectedRevision),
                isNull(subgraphs.deletedAt),
              ),
            )
            .returning();

          const updated = updatedRows[0];
          if (!updated) {
            return { kind: "conflict" as const, detail: "Revision mismatch." };
          }

          await tx.insert(subgraphRevisions).values({
            subgraphId: updated.id,
            revisionId: updated.revisionId,
            routingUrl: updated.routingUrl,
            createdAt: now,
          });

          return {
            kind: "success" as const,
            statusCode: 200 as const,
            graphExternalId: graph.externalId,
            subgraph: updated,
          };
        }

        if (expectedRevision !== 0) {
          return {
            kind: "conflict" as const,
            detail: "X-Revision must be 0 when creating a new subgraph.",
          };
        }

        try {
          const createdRows = await tx
            .insert(subgraphs)
            .values({
              graphId: graph.id,
              slug: subgraphSlug,
              routingUrl,
              revisionId: 1,
              createdAt: now,
              updatedAt: now,
            })
            .returning();

          const created = createdRows[0];
          if (!created) {
            throw new Error("Subgraph insert did not return a row.");
          }

          await tx.insert(subgraphRevisions).values({
            subgraphId: created.id,
            revisionId: created.revisionId,
            routingUrl: created.routingUrl,
            createdAt: now,
          });

          return {
            kind: "success" as const,
            statusCode: 201 as const,
            graphExternalId: graph.externalId,
            subgraph: created,
          };
        } catch (error) {
          if (isUniqueViolation(error)) {
            return { kind: "conflict" as const, detail: "Subgraph slug is already in use." };
          }

          throw error;
        }
      });

      if (result.kind === "not_found") {
        reply.notFound(result.detail);
        return;
      }

      if (result.kind === "conflict") {
        reply.conflict(result.detail);
        return;
      }

      reply.code(result.statusCode);
      return mapSubgraphRowToResponse(result.subgraph, result.graphExternalId);
    },
  );

  server.get(
    "/v1/graphs/:graphSlug/supergraph.graphqls",
    {
      schema: {
        params: graphParamsSchema,
      },
    },
    async (request, reply) => {
      const isAuthorized = await requireGraphReadScope(request, reply, options.database);
      if (!isAuthorized) {
        return;
      }

      sendNotImplemented(request, reply);
    },
  );

  server.post(
    "/v1/graphs/:graphSlug/subgraphs/:subgraphSlug/schema.graphqls",
    {
      schema: {
        params: subgraphParamsSchema,
      },
    },
    async (request, reply) => {
      const isAuthorized = await requireSubgraphWriteScope(request, reply, options.database);
      if (!isAuthorized) {
        return;
      }

      sendNotImplemented(request, reply);
    },
  );

  done();
};

export const registryPlugin = fastifyPlugin(registryPluginImpl, {
  fastify: "5.x",
  name: "registry",
});
