import { and, eq, isNull } from "drizzle-orm";

import { graphs, graphRevisions, subgraphs } from "../../drizzle/schema.ts";
import type { PostgresJsTransaction } from "../../drizzle/types.ts";
import type { IfMatchCondition } from "../etag.ts";
import { etagSatisfiesIfMatch, formatStrongETag } from "../etag.ts";
import type { ActiveGraph } from "./graph-records.ts";

const initialRevision = 1;

const graphRowSelection = {
  id: graphs.id,
  slug: graphs.slug,
  createdAt: graphs.createdAt,
  updatedAt: graphs.updatedAt,
};

const graphIdSelection = {
  id: graphs.id,
};

async function insertGraphRow(
  transaction: PostgresJsTransaction,
  slug: string,
  now: Date,
): Promise<Pick<ActiveGraph, "createdAt" | "id" | "slug" | "updatedAt">> {
  const [insertedGraph] = await transaction
    .insert(graphs)
    .values({
      slug,
      revision: initialRevision,
      createdAt: now,
      updatedAt: now,
    })
    .returning(graphRowSelection);

  if (!insertedGraph) {
    throw new Error("Graph insert did not return a row.");
  }

  return insertedGraph;
}

async function insertGraphRevision(
  transaction: PostgresJsTransaction,
  graphId: string,
  revision: number,
  federationVersion: string,
  createdAt: Date,
): Promise<void> {
  await transaction.insert(graphRevisions).values({
    graphId,
    revision,
    federationVersion,
    createdAt,
  });
}

async function setGraphRevision(
  transaction: PostgresJsTransaction,
  graphId: string,
  revision: number,
  now: Date,
): Promise<Pick<ActiveGraph, "createdAt" | "id" | "slug" | "updatedAt">> {
  const [updatedGraph] = await transaction
    .update(graphs)
    .set({
      revision,
      updatedAt: now,
    })
    .where(and(eq(graphs.id, graphId), isNull(graphs.deletedAt)))
    .returning(graphRowSelection);

  if (!updatedGraph) {
    throw new Error("Graph update did not return the locked row.");
  }

  return updatedGraph;
}

export async function insertGraphWithInitialRevision(
  transaction: PostgresJsTransaction,
  slug: string,
  federationVersion: string,
  now: Date,
): Promise<ActiveGraph> {
  const insertedGraph = await insertGraphRow(transaction, slug, now);
  await insertGraphRevision(transaction, insertedGraph.id, initialRevision, federationVersion, now);

  return {
    ...insertedGraph,
    federationVersion,
    revision: initialRevision,
  };
}

export function checkGraphIfMatch(
  graph: ActiveGraph,
  ifMatch: IfMatchCondition | undefined,
): { kind: "precondition_failed" } | undefined {
  if (etagSatisfiesIfMatch(ifMatch, formatStrongETag(graph.id, graph.revision))) {
    return undefined;
  }

  return {
    kind: "precondition_failed",
  };
}

export async function advanceGraphRevision(
  transaction: PostgresJsTransaction,
  graph: ActiveGraph,
  federationVersion: string,
  now: Date,
): Promise<ActiveGraph> {
  const revision = graph.revision + 1;

  await insertGraphRevision(transaction, graph.id, revision, federationVersion, now);

  const updatedGraph = await setGraphRevision(transaction, graph.id, revision, now);
  return {
    ...updatedGraph,
    federationVersion,
    revision,
  };
}

export async function softDeleteGraphAndSubgraphsById(
  transaction: PostgresJsTransaction,
  graphId: string,
  now: Date,
): Promise<void> {
  const [deletedGraph] = await transaction
    .update(graphs)
    .set({
      updatedAt: now,
      deletedAt: now,
    })
    .where(and(eq(graphs.id, graphId), isNull(graphs.deletedAt)))
    .returning(graphIdSelection);

  if (!deletedGraph) {
    throw new Error("Graph delete did not return the locked row.");
  }

  await transaction
    .update(subgraphs)
    .set({
      updatedAt: now,
      deletedAt: now,
    })
    .where(and(eq(subgraphs.graphId, deletedGraph.id), isNull(subgraphs.deletedAt)));
}
