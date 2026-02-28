import { and, eq, isNull } from "drizzle-orm";

import { graphRevisions, graphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import type { RouteHandlers } from "../openapi-ts/fastify.gen.ts";
import { getGraphBySlug } from "./graph-database.ts";
import type { PersistedGraph } from "./graph-response.ts";
import { toGraphResponse } from "./graph-response.ts";

type ProblemError = {
  code: "CONFLICT" | "INVALID_REQUEST";
  detail: string;
  status: number;
  title: string;
  type: string;
};

type UpsertGraphConflictResult = {
  conflictDetail: string;
};

type UpsertGraphSuccessResult = {
  graph: PersistedGraph;
  statusCode: 200 | 201;
};

type UpsertGraphTransactionResult = UpsertGraphConflictResult | UpsertGraphSuccessResult;

function toConflictError(detail: string): ProblemError {
  return {
    code: "CONFLICT",
    detail,
    status: 409,
    title: "Conflict",
    type: "https://chikachow.org/graphql-schema-registry/errors/conflict",
  };
}

function toInvalidRequestError(detail: string): ProblemError {
  return {
    code: "INVALID_REQUEST",
    detail,
    status: 422,
    title: "Unprocessable Entity",
    type: "https://chikachow.org/graphql-schema-registry/errors/invalid-request",
  };
}

function parseRevisionId(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    return undefined;
  }

  return parsed;
}

function isUniqueViolationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  return Reflect.get(error, "code") === "23505";
}

function isConflictResult(
  result: UpsertGraphTransactionResult,
): result is UpsertGraphConflictResult {
  return "conflictDetail" in result;
}

export function createUpsertGraphHandler({
  database,
}: {
  database?: PostgresJsDatabase | undefined;
}): RouteHandlers["upsertGraph"] {
  return async (request, reply) => {
    if (!database) {
      reply.serviceUnavailable("Database is not configured.");
      return;
    }

    const providedRevisionId = parseRevisionId(request.headers["x-revision-id"]);
    if (providedRevisionId === undefined) {
      reply.code(422).send(toInvalidRequestError("x-revision-id must be a safe integer."));
      return;
    }

    const now = new Date();

    try {
      const result: UpsertGraphTransactionResult = await database.transaction(
        async (transaction) => {
          const existingGraph = await getGraphBySlug(transaction, request.params.graphSlug);

          if (providedRevisionId === 0) {
            if (existingGraph) {
              return {
                conflictDetail: "Graph already exists. Use the current revision id to update it.",
              };
            }

            const [createdGraph] = await transaction
              .insert(graphs)
              .values({
                createdAt: now,
                currentRevisionId: 1,
                slug: request.params.graphSlug,
                updatedAt: now,
              })
              .returning({
                createdAt: graphs.createdAt,
                externalId: graphs.externalId,
                id: graphs.id,
                slug: graphs.slug,
                updatedAt: graphs.updatedAt,
              });

            if (!createdGraph) {
              return {
                conflictDetail: "Graph already exists.",
              };
            }

            await transaction.insert(graphRevisions).values({
              createdAt: now,
              federationVersion: request.body.federationVersion,
              graphId: createdGraph.id,
              revisionId: 1,
            });

            return {
              graph: {
                createdAt: createdGraph.createdAt,
                externalId: createdGraph.externalId,
                federationVersion: request.body.federationVersion,
                id: createdGraph.id,
                revisionId: 1,
                slug: createdGraph.slug,
                updatedAt: createdGraph.updatedAt,
              },
              statusCode: 201,
            };
          }

          if (!existingGraph) {
            return {
              conflictDetail: "Revision mismatch. Provide the current revision id to update.",
            };
          }

          const currentRevision = existingGraph.currentRevision;
          if (!currentRevision) {
            throw new Error("Graph is missing a current revision.");
          }

          const currentRevisionId = currentRevision.revisionId;
          if (currentRevisionId !== providedRevisionId) {
            return {
              conflictDetail: "Revision mismatch. Provide the current revision id to update.",
            };
          }

          const nextRevisionId = currentRevisionId + 1;
          const [updatedGraph] = await transaction
            .update(graphs)
            .set({
              currentRevisionId: nextRevisionId,
              updatedAt: now,
            })
            .where(
              and(
                eq(graphs.id, existingGraph.id),
                isNull(graphs.deletedAt),
                eq(graphs.currentRevisionId, currentRevisionId),
              ),
            )
            .returning({
              createdAt: graphs.createdAt,
              externalId: graphs.externalId,
              id: graphs.id,
              slug: graphs.slug,
              updatedAt: graphs.updatedAt,
            });

          if (!updatedGraph) {
            return {
              conflictDetail: "Revision mismatch. Provide the current revision id to update.",
            };
          }

          await transaction.insert(graphRevisions).values({
            createdAt: now,
            federationVersion: request.body.federationVersion,
            graphId: updatedGraph.id,
            revisionId: nextRevisionId,
          });

          return {
            graph: {
              createdAt: updatedGraph.createdAt,
              externalId: updatedGraph.externalId,
              federationVersion: request.body.federationVersion,
              id: updatedGraph.id,
              revisionId: nextRevisionId,
              slug: updatedGraph.slug,
              updatedAt: updatedGraph.updatedAt,
            },
            statusCode: 200,
          };
        },
      );

      if (isConflictResult(result)) {
        reply.code(409).send(toConflictError(result.conflictDetail));
        return;
      }

      reply.code(result.statusCode).send(toGraphResponse(result.graph));
    } catch (error) {
      if (isUniqueViolationError(error)) {
        reply
          .code(409)
          .send(toConflictError("Graph already exists. Use the current revision id to update it."));
        return;
      }

      throw error;
    }
  };
}

export function createDeleteGraphHandler({
  database,
}: {
  database?: PostgresJsDatabase | undefined;
}): RouteHandlers["deleteGraph"] {
  return async (request, reply) => {
    if (!database) {
      reply.serviceUnavailable("Database is not configured.");
      return;
    }

    const now = new Date();
    const deletedGraphs = await database
      .update(graphs)
      .set({
        deletedAt: now,
        updatedAt: now,
      })
      .where(and(eq(graphs.slug, request.params.graphSlug), isNull(graphs.deletedAt)))
      .returning({
        id: graphs.id,
      });

    if (deletedGraphs.length === 0) {
      reply.notFound("Graph not found.");
      return;
    }

    reply.code(204).send();
  };
}
