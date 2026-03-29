import { and, eq, isNull } from "drizzle-orm";

import { subgraphRevisions, subgraphs } from "../../../drizzle/schema.ts";
import type { PostgresJsTransaction } from "../../../drizzle/types.ts";
import type { ActiveSubgraph } from "../types.ts";
import { initialRevision, subgraphIdSelection, subgraphRowSelection } from "./selections.ts";

async function insertSubgraphRow(
  transaction: PostgresJsTransaction,
  graphId: string,
  slug: string,
  now: Date,
): Promise<Pick<ActiveSubgraph, "createdAt" | "graphId" | "id" | "slug" | "updatedAt">> {
  const [insertedSubgraph] = await transaction
    .insert(subgraphs)
    .values({
      graphId,
      slug,
      currentRevision: initialRevision,
      createdAt: now,
      updatedAt: now,
    })
    .returning(subgraphRowSelection);

  if (!insertedSubgraph) {
    throw new Error("Subgraph insert did not return a row.");
  }

  return insertedSubgraph;
}

async function insertSubgraphRevision(
  transaction: PostgresJsTransaction,
  subgraphId: string,
  revision: number,
  routingUrl: string,
  createdAt: Date,
): Promise<void> {
  await transaction.insert(subgraphRevisions).values({
    subgraphId,
    revision,
    routingUrl,
    createdAt,
  });
}

async function setSubgraphRevision(
  transaction: PostgresJsTransaction,
  subgraphId: string,
  revision: number,
  now: Date,
): Promise<Pick<ActiveSubgraph, "createdAt" | "graphId" | "id" | "slug" | "updatedAt">> {
  const [updatedSubgraph] = await transaction
    .update(subgraphs)
    .set({
      currentRevision: revision,
      updatedAt: now,
    })
    .where(and(eq(subgraphs.id, subgraphId), isNull(subgraphs.deletedAt)))
    .returning(subgraphRowSelection);

  if (!updatedSubgraph) {
    throw new Error("Subgraph update did not return the locked row.");
  }

  return updatedSubgraph;
}

export async function insertSubgraphWithInitialRevision(
  transaction: PostgresJsTransaction,
  graphId: string,
  slug: string,
  routingUrl: string,
  now: Date,
): Promise<ActiveSubgraph> {
  const subgraph = await insertSubgraphRow(transaction, graphId, slug, now);

  await insertSubgraphRevision(transaction, subgraph.id, initialRevision, routingUrl, now);

  return {
    ...subgraph,
    currentRevision: initialRevision,
    routingUrl,
  };
}

export async function insertSubgraphRevisionAndSetCurrent(
  transaction: PostgresJsTransaction,
  subgraphId: string,
  revision: number,
  routingUrl: string,
  now: Date,
): Promise<ActiveSubgraph> {
  await insertSubgraphRevision(transaction, subgraphId, revision, routingUrl, now);

  const updatedSubgraph = await setSubgraphRevision(transaction, subgraphId, revision, now);

  return {
    ...updatedSubgraph,
    currentRevision: revision,
    routingUrl,
  };
}

export async function softDeleteSubgraphById(
  transaction: PostgresJsTransaction,
  subgraphId: string,
  now: Date,
): Promise<void> {
  const [deletedSubgraph] = await transaction
    .update(subgraphs)
    .set({
      updatedAt: now,
      deletedAt: now,
    })
    .where(and(eq(subgraphs.id, subgraphId), isNull(subgraphs.deletedAt)))
    .returning(subgraphIdSelection);

  if (!deletedSubgraph) {
    throw new Error("Subgraph delete did not return the locked row.");
  }
}
