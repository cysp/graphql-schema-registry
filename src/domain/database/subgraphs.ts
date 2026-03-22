import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { etagSatisfiesIfMatch, type IfMatchCondition } from "../etag.ts";
import { lockActiveGraphBySlug, lockActiveGraphIdBySlug } from "./graph-records.ts";
import { checkGraphIfMatch } from "./graph-write-helpers.ts";
import { isUniqueViolation } from "./postgres-errors.ts";
import { lockActiveSubgraphByGraphIdAndSlug, type ActiveSubgraph } from "./subgraph-records.ts";
import {
  checkSubgraphIfMatch,
  insertSubgraphWithInitialRevision,
  softDeleteSubgraphById,
  advanceSubgraphRevision,
} from "./subgraph-write-helpers.ts";

export type CreateSubgraphInput = {
  graphSlug: string;
  slug: string;
  ifMatch?: IfMatchCondition | undefined;
  routingUrl: string;
  now: Date;
};

export type CreateSubgraphResult =
  | {
      kind: "created";
      subgraph: ActiveSubgraph;
    }
  | {
      kind: "conflict";
    }
  | {
      kind: "not_found";
    }
  | {
      kind: "precondition_failed";
    };

export type UpdateSubgraphInput = {
  graphSlug: string;
  subgraphSlug: string;
  ifMatch: IfMatchCondition | undefined;
  routingUrl: string;
  now: Date;
};

export type UpdateSubgraphResult =
  | {
      kind: "ok";
      subgraph: ActiveSubgraph;
    }
  | {
      kind: "not_found";
    }
  | {
      kind: "precondition_failed";
    };

export type DeleteSubgraphInput = {
  graphSlug: string;
  subgraphSlug: string;
  ifMatch: IfMatchCondition | undefined;
  now: Date;
};

export type DeleteSubgraphResult =
  | {
      kind: "no_content";
    }
  | {
      kind: "precondition_failed";
    };

export async function createSubgraph(
  database: PostgresJsDatabase,
  input: CreateSubgraphInput,
): Promise<CreateSubgraphResult> {
  try {
    return await database.transaction(async (transaction) => {
      const graph = await lockActiveGraphBySlug(transaction, input.graphSlug);
      if (!graph) {
        return etagSatisfiesIfMatch(input.ifMatch, undefined)
          ? {
              kind: "not_found",
            }
          : {
              kind: "precondition_failed",
            };
      }

      const preconditionFailure = checkGraphIfMatch(graph, input.ifMatch);
      if (preconditionFailure) {
        return preconditionFailure;
      }

      return {
        kind: "created",
        subgraph: await insertSubgraphWithInitialRevision(
          transaction,
          graph.id,
          input.slug,
          input.routingUrl,
          input.now,
        ),
      } satisfies CreateSubgraphResult;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        kind: "conflict",
      };
    }

    throw error;
  }
}

export async function updateSubgraphBySlugs(
  database: PostgresJsDatabase,
  input: UpdateSubgraphInput,
): Promise<UpdateSubgraphResult> {
  return database.transaction(async (transaction) => {
    const graphId = await lockActiveGraphIdBySlug(transaction, input.graphSlug);
    if (!graphId) {
      return etagSatisfiesIfMatch(input.ifMatch, undefined)
        ? {
            kind: "not_found",
          }
        : {
            kind: "precondition_failed",
          };
    }

    const subgraph = await lockActiveSubgraphByGraphIdAndSlug(
      transaction,
      graphId,
      input.subgraphSlug,
    );
    if (!subgraph) {
      return etagSatisfiesIfMatch(input.ifMatch, undefined)
        ? {
            kind: "not_found",
          }
        : {
            kind: "precondition_failed",
          };
    }

    const preconditionFailure = checkSubgraphIfMatch(subgraph, input.ifMatch);
    if (preconditionFailure) {
      return preconditionFailure;
    }

    if (subgraph.routingUrl === input.routingUrl) {
      return {
        kind: "ok",
        subgraph,
      };
    }

    return {
      kind: "ok",
      subgraph: await advanceSubgraphRevision(transaction, subgraph, input.routingUrl, input.now),
    };
  });
}

export async function deleteSubgraphBySlugs(
  database: PostgresJsDatabase,
  input: DeleteSubgraphInput,
): Promise<DeleteSubgraphResult> {
  return database.transaction(async (transaction) => {
    const graphId = await lockActiveGraphIdBySlug(transaction, input.graphSlug);
    if (!graphId) {
      return etagSatisfiesIfMatch(input.ifMatch, undefined)
        ? {
            kind: "no_content",
          }
        : {
            kind: "precondition_failed",
          };
    }

    const subgraph = await lockActiveSubgraphByGraphIdAndSlug(
      transaction,
      graphId,
      input.subgraphSlug,
    );
    if (!subgraph) {
      return etagSatisfiesIfMatch(input.ifMatch, undefined)
        ? {
            kind: "no_content",
          }
        : {
            kind: "precondition_failed",
          };
    }

    const preconditionFailure = checkSubgraphIfMatch(subgraph, input.ifMatch);
    if (preconditionFailure) {
      return preconditionFailure;
    }

    await softDeleteSubgraphById(transaction, subgraph.id, input.now);

    return {
      kind: "no_content",
    };
  });
}
