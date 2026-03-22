import type { PostgresJsDatabase } from "../../drizzle/types.ts";
import { etagSatisfiesIfMatch, type IfMatchCondition } from "../etag.ts";
import { lockActiveGraphBySlug, type ActiveGraph } from "./graph-records.ts";
import {
  checkGraphIfMatch,
  insertGraphWithInitialRevision,
  softDeleteGraphAndSubgraphsById,
  advanceGraphRevision,
} from "./graph-write-helpers.ts";
import { isUniqueViolation } from "./postgres-errors.ts";

export type CreateGraphInput = {
  slug: string;
  federationVersion: string;
  now: Date;
};

export type CreateGraphResult =
  | {
      kind: "created";
      graph: ActiveGraph;
    }
  | {
      kind: "conflict";
    };

export type UpdateGraphInput = {
  slug: string;
  ifMatch: IfMatchCondition | undefined;
  federationVersion: string;
  now: Date;
};

export type UpdateGraphResult =
  | {
      kind: "ok";
      graph: ActiveGraph;
    }
  | {
      kind: "not_found";
    }
  | {
      kind: "precondition_failed";
    };

export type DeleteGraphInput = {
  slug: string;
  ifMatch: IfMatchCondition | undefined;
  now: Date;
};

export type DeleteGraphResult =
  | {
      kind: "no_content";
    }
  | {
      kind: "precondition_failed";
    };

export async function createGraph(
  database: PostgresJsDatabase,
  input: CreateGraphInput,
): Promise<CreateGraphResult> {
  try {
    const graph = await database.transaction(async (transaction) =>
      insertGraphWithInitialRevision(transaction, input.slug, input.federationVersion, input.now),
    );

    return {
      kind: "created",
      graph,
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        kind: "conflict",
      };
    }

    throw error;
  }
}

export async function updateGraphBySlug(
  database: PostgresJsDatabase,
  input: UpdateGraphInput,
): Promise<UpdateGraphResult> {
  return database.transaction(async (transaction) => {
    let graph = await lockActiveGraphBySlug(transaction, input.slug);
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

    if (graph.federationVersion === input.federationVersion) {
      return {
        kind: "ok",
        graph,
      };
    }

    graph = await advanceGraphRevision(transaction, graph, input.federationVersion, input.now);

    return {
      kind: "ok",
      graph,
    };
  });
}

export async function deleteGraphBySlug(
  database: PostgresJsDatabase,
  input: DeleteGraphInput,
): Promise<DeleteGraphResult> {
  return database.transaction(async (transaction) => {
    const graph = await lockActiveGraphBySlug(transaction, input.slug);
    if (!graph) {
      return etagSatisfiesIfMatch(input.ifMatch, undefined)
        ? {
            kind: "no_content",
          }
        : {
            kind: "precondition_failed",
          };
    }

    const preconditionFailure = checkGraphIfMatch(graph, input.ifMatch);
    if (preconditionFailure) {
      return preconditionFailure;
    }

    await softDeleteGraphAndSubgraphsById(transaction, graph.id, input.now);

    return {
      kind: "no_content",
    };
  });
}
