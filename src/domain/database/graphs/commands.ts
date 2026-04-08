import { and, eq, isNull } from "drizzle-orm";

import { graphRevisions, graphs, subgraphs } from "../../../drizzle/schema.ts";
import type { PostgresJsTransaction } from "../../../drizzle/types.ts";
import type { ActiveGraph } from "../types.ts";
import { graphIdSelection, graphRowSelection, initialRevision } from "./selections.ts";

async function insertGraphRow(
  transaction: PostgresJsTransaction,
  slug: string,
  now: Date,
): Promise<Pick<ActiveGraph, "id" | "slug" | "createdAt" | "updatedAt">> {
  const [insertedGraph] = await transaction
    .insert(graphs)
    .values({
      slug,
      currentRevision: initialRevision,
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
  revision: bigint,
  createdAt: Date,
): Promise<void> {
  await transaction.insert(graphRevisions).values({
    graphId,
    revision,
    createdAt,
  });
}

export async function insertGraphWithInitialRevision(
  transaction: PostgresJsTransaction,
  slug: string,
  now: Date,
): Promise<ActiveGraph> {
  const graph = await insertGraphRow(transaction, slug, now);

  await insertGraphRevision(transaction, graph.id, initialRevision, now);

  return {
    ...graph,
    currentRevision: initialRevision,
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
