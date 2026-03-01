import { and, eq, isNull } from "drizzle-orm";
import type { PickDeep } from "type-fest";

import { graphRevisions, graphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { requireAdminUser } from "../../lib/fastify/authorization/guards.ts";
import type { DependencyInjectedHandlerContext } from "../../lib/fastify/handler-with-dependencies.ts";
import type { RouteHandlers } from "../../lib/openapi-ts/fastify.gen.ts";
import type { Graph } from "../../lib/openapi-ts/types.gen.ts";
import { getActiveGraphBySlug } from "../database/get-active-graph-by-slug.ts";
import { GRAPH_MISSING_CURRENT_REVISION_MESSAGE, requireDatabase } from "./graph-route-shared.ts";

type RouteDependencies = Readonly<{
  database: PickDeep<PostgresJsDatabase, "transaction"> | undefined;
}>;

const GRAPH_ALREADY_EXISTS_CONFLICT_DETAIL =
  "Graph already exists. Use the current revision id to update it.";
const GRAPH_ALREADY_EXISTS_DETAIL = "Graph already exists.";
const REVISION_MISMATCH_CONFLICT_DETAIL =
  "Revision mismatch. Provide the current revision id to update.";

const graphRecordFields = {
  createdAt: graphs.createdAt,
  externalId: graphs.externalId,
  id: graphs.id,
  slug: graphs.slug,
  updatedAt: graphs.updatedAt,
} as const;

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
  graph: Graph;
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
  transactionResult: UpsertGraphTransactionResult,
): transactionResult is UpsertGraphConflictResult {
  return "conflictDetail" in transactionResult;
}

export async function upsertGraphHandler({
  request,
  reply,
  dependencies: { database },
}: DependencyInjectedHandlerContext<
  RouteHandlers["upsertGraph"],
  RouteDependencies
>): Promise<void> {
  if (!requireDatabase(database, reply)) {
    return;
  }

  if (!requireAdminUser(request, reply)) {
    return;
  }

  const requestRevisionId = parseRevisionId(request.headers["x-revision-id"]);
  if (requestRevisionId === undefined) {
    reply.code(422).send(toInvalidRequestError("x-revision-id must be a safe integer."));
    return;
  }

  const now = new Date();

  try {
    const transactionResult: UpsertGraphTransactionResult = await database.transaction(
      async (transaction) => {
        const existingGraphRecord = await getActiveGraphBySlug(
          transaction,
          request.params.graphSlug,
        );

        if (requestRevisionId === 0) {
          if (existingGraphRecord) {
            return {
              conflictDetail: GRAPH_ALREADY_EXISTS_CONFLICT_DETAIL,
            };
          }

          const [createdGraphRecord] = await transaction
            .insert(graphs)
            .values({
              createdAt: now,
              currentRevisionId: 1,
              slug: request.params.graphSlug,
              updatedAt: now,
            })
            .returning(graphRecordFields);

          if (!createdGraphRecord) {
            return {
              conflictDetail: GRAPH_ALREADY_EXISTS_DETAIL,
            };
          }

          await transaction.insert(graphRevisions).values({
            createdAt: now,
            federationVersion: request.body.federationVersion,
            graphId: createdGraphRecord.id,
            revisionId: 1,
          });

          return {
            graph: {
              createdAt: createdGraphRecord.createdAt.toISOString(),
              federationVersion: request.body.federationVersion,
              id: createdGraphRecord.externalId,
              revisionId: "1",
              slug: createdGraphRecord.slug,
              updatedAt: createdGraphRecord.updatedAt.toISOString(),
            },
            statusCode: 201,
          };
        }

        if (!existingGraphRecord) {
          return {
            conflictDetail: REVISION_MISMATCH_CONFLICT_DETAIL,
          };
        }

        const revisionRecord = existingGraphRecord.currentRevision;
        if (!revisionRecord) {
          throw new Error(GRAPH_MISSING_CURRENT_REVISION_MESSAGE);
        }

        const currentRevisionId = revisionRecord.revisionId;
        if (currentRevisionId !== requestRevisionId) {
          return {
            conflictDetail: REVISION_MISMATCH_CONFLICT_DETAIL,
          };
        }

        const nextRevisionId = currentRevisionId + 1;
        const [updatedGraphRecord] = await transaction
          .update(graphs)
          .set({
            currentRevisionId: nextRevisionId,
            updatedAt: now,
          })
          .where(
            and(
              eq(graphs.id, existingGraphRecord.id),
              isNull(graphs.deletedAt),
              eq(graphs.currentRevisionId, currentRevisionId),
            ),
          )
          .returning(graphRecordFields);

        if (!updatedGraphRecord) {
          return {
            conflictDetail: REVISION_MISMATCH_CONFLICT_DETAIL,
          };
        }

        await transaction.insert(graphRevisions).values({
          createdAt: now,
          federationVersion: request.body.federationVersion,
          graphId: updatedGraphRecord.id,
          revisionId: nextRevisionId,
        });

        return {
          graph: {
            createdAt: updatedGraphRecord.createdAt.toISOString(),
            federationVersion: request.body.federationVersion,
            id: updatedGraphRecord.externalId,
            revisionId: String(nextRevisionId),
            slug: updatedGraphRecord.slug,
            updatedAt: updatedGraphRecord.updatedAt.toISOString(),
          },
          statusCode: 200,
        };
      },
    );

    if (isConflictResult(transactionResult)) {
      reply.code(409).send(toConflictError(transactionResult.conflictDetail));
      return;
    }

    reply.code(transactionResult.statusCode).send(transactionResult.graph);
  } catch (error) {
    if (isUniqueViolationError(error)) {
      reply.code(409).send(toConflictError(GRAPH_ALREADY_EXISTS_CONFLICT_DETAIL));
      return;
    }

    throw error;
  }
}
