import { and, eq, isNull } from "drizzle-orm";

import { graphRevisions, graphs, subgraphs } from "../../../drizzle/schema.ts";
import type { PostgresJsTransaction } from "../../../drizzle/types.ts";
import type { ActiveGraph } from "../types.ts";
import { graphIdSelection, graphRowSelection, initialRevision } from "./selections.ts";

async function insertGraphRow(
  transaction: PostgresJsTransaction,
  slug: string,
  now: Date,
): Promise<
  Pick<ActiveGraph, "id" | "slug" | "currentCompositionRevision" | "createdAt" | "updatedAt">
> {
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
): Promise<
  Pick<ActiveGraph, "id" | "slug" | "currentCompositionRevision" | "createdAt" | "updatedAt">
> {
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
  const graph = await insertGraphRow(transaction, slug, now);

  await insertGraphRevision(transaction, graph.id, initialRevision, federationVersion, now);

  return {
    ...graph,
    revision: initialRevision,
    federationVersion,
  };
}

export async function insertGraphRevisionAndSetCurrent(
  transaction: PostgresJsTransaction,
  graphId: string,
  revision: number,
  federationVersion: string,
  now: Date,
): Promise<ActiveGraph> {
  await insertGraphRevision(transaction, graphId, revision, federationVersion, now);

  const graph = await setGraphRevision(transaction, graphId, revision, now);

  return {
    ...graph,
    revision,
    federationVersion,
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
