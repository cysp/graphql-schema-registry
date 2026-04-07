import { and, asc, desc, eq, isNull } from "drizzle-orm";

import {
  graphs,
  subgraphRevisions,
  subgraphSchemaRevisions,
  subgraphs,
  supergraphSchemaRevisionSubgraphs,
  supergraphSchemaRevisions,
} from "../../../drizzle/schema.ts";
import type { PostgresJsExecutor, PostgresJsTransaction } from "../../../drizzle/types.ts";
import type { CompositionEligibleSubgraph, StoredSupergraphSchemaRevision } from "../types.ts";

export async function selectEligibleCompositionSubgraphsByGraphId(
  database: PostgresJsExecutor,
  graphId: string,
): Promise<CompositionEligibleSubgraph[]> {
  return database
    .select({
      subgraphId: subgraphs.id,
      subgraphSlug: subgraphs.slug,
      subgraphRevision: subgraphRevisions.revision,
      routingUrl: subgraphRevisions.routingUrl,
      subgraphSchemaRevision: subgraphSchemaRevisions.revision,
      normalizedSdl: subgraphSchemaRevisions.normalizedSdl,
    })
    .from(subgraphs)
    .innerJoin(
      subgraphRevisions,
      and(
        eq(subgraphRevisions.subgraphId, subgraphs.id),
        eq(subgraphRevisions.revision, subgraphs.currentRevision),
      ),
    )
    .innerJoin(
      subgraphSchemaRevisions,
      and(
        eq(subgraphSchemaRevisions.subgraphId, subgraphs.id),
        eq(subgraphSchemaRevisions.revision, subgraphs.currentSchemaRevision),
      ),
    )
    .where(and(eq(subgraphs.graphId, graphId), isNull(subgraphs.deletedAt)))
    .orderBy(asc(subgraphs.slug));
}

export async function selectLatestSupergraphSchemaRevision(
  database: PostgresJsExecutor,
  graphId: string,
): Promise<StoredSupergraphSchemaRevision | undefined> {
  const [revision] = await database
    .select({
      graphId: supergraphSchemaRevisions.graphId,
      revision: supergraphSchemaRevisions.revision,
      supergraphSdl: supergraphSchemaRevisions.supergraphSdl,
      schemaHash: supergraphSchemaRevisions.schemaHash,
      createdAt: supergraphSchemaRevisions.createdAt,
    })
    .from(supergraphSchemaRevisions)
    .where(eq(supergraphSchemaRevisions.graphId, graphId))
    .orderBy(desc(supergraphSchemaRevisions.revision))
    .limit(1);

  return revision;
}

export async function insertSupergraphSchemaRevisionSubgraphs(
  transaction: PostgresJsTransaction,
  {
    graphId,
    supergraphSchemaRevision,
    subgraphs,
  }: {
    graphId: string;
    supergraphSchemaRevision: bigint;
    subgraphs: readonly CompositionEligibleSubgraph[];
  },
): Promise<void> {
  if (subgraphs.length === 0) {
    return;
  }

  await transaction.insert(supergraphSchemaRevisionSubgraphs).values(
    subgraphs.map((subgraph) => ({
      graphId,
      supergraphSchemaRevision,
      subgraphId: subgraph.subgraphId,
      subgraphRevision: subgraph.subgraphRevision,
      subgraphSchemaRevision: subgraph.subgraphSchemaRevision,
    })),
  );
}

export async function insertSupergraphSchemaRevisionAndSetCurrent(
  transaction: PostgresJsTransaction,
  revision: StoredSupergraphSchemaRevision,
): Promise<void> {
  await transaction.insert(supergraphSchemaRevisions).values(revision);

  const [updatedGraph] = await transaction
    .update(graphs)
    .set({
      currentSupergraphSchemaRevision: revision.revision,
    })
    .where(and(eq(graphs.id, revision.graphId), isNull(graphs.deletedAt)))
    .returning({ id: graphs.id });

  if (!updatedGraph) {
    throw new Error("Supergraph pointer update did not return the updated graph row.");
  }
}

export async function clearCurrentSupergraphSchemaRevision(
  transaction: PostgresJsTransaction,
  graphId: string,
): Promise<void> {
  const [updatedGraph] = await transaction
    .update(graphs)
    .set({
      currentSupergraphSchemaRevision: null,
    })
    .where(and(eq(graphs.id, graphId), isNull(graphs.deletedAt)))
    .returning({ id: graphs.id });

  if (!updatedGraph) {
    throw new Error("Supergraph pointer clear did not return the updated graph row.");
  }
}
