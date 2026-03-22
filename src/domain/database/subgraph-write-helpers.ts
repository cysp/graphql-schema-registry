import { and, eq, isNull } from "drizzle-orm";

import { subgraphRevisions, subgraphs } from "../../drizzle/schema.ts";
import type { PostgresJsTransaction } from "../../drizzle/types.ts";
import type { IfMatchCondition } from "../etag.ts";
import { etagSatisfiesIfMatch, formatStrongETag } from "../etag.ts";
import type { ActiveSubgraph } from "./subgraph-records.ts";

const initialRevision = 1;

const subgraphRowSelection = {
  id: subgraphs.id,
  graphId: subgraphs.graphId,
  slug: subgraphs.slug,
  createdAt: subgraphs.createdAt,
  updatedAt: subgraphs.updatedAt,
};

const subgraphIdSelection = {
  id: subgraphs.id,
};

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
      revision: initialRevision,
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
      revision,
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
  const insertedSubgraph = await insertSubgraphRow(transaction, graphId, slug, now);
  await insertSubgraphRevision(transaction, insertedSubgraph.id, initialRevision, routingUrl, now);

  return {
    ...insertedSubgraph,
    revision: initialRevision,
    routingUrl,
  };
}

export function checkSubgraphIfMatch(
  subgraph: ActiveSubgraph,
  ifMatch: IfMatchCondition | undefined,
): { kind: "precondition_failed" } | undefined {
  if (etagSatisfiesIfMatch(ifMatch, formatStrongETag(subgraph.id, subgraph.revision))) {
    return undefined;
  }

  return {
    kind: "precondition_failed",
  };
}

export async function advanceSubgraphRevision(
  transaction: PostgresJsTransaction,
  subgraph: ActiveSubgraph,
  routingUrl: string,
  now: Date,
): Promise<ActiveSubgraph> {
  const revision = subgraph.revision + 1;

  await insertSubgraphRevision(transaction, subgraph.id, revision, routingUrl, now);

  const updatedSubgraph = await setSubgraphRevision(transaction, subgraph.id, revision, now);

  return {
    ...updatedSubgraph,
    revision,
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
