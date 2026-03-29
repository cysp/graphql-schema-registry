import { and, desc, eq } from "drizzle-orm";

import {
  graphs,
  graphCompositionGraphRevisions,
  graphCompositionSubgraphRevisions,
  graphCompositionSubgraphSchemaRevisions,
  graphCompositions,
} from "../../../drizzle/schema.ts";
import type { PostgresJsExecutor, PostgresJsTransaction } from "../../../drizzle/types.ts";
import type { StoredGraphComposition } from "../types.ts";

export type StoredGraphCompositionInput = {
  compositionHash: string;
  createdAt: Date;
  graphId: string;
  graphRevision: number;
  revision: number;
  subgraphs: Array<{
    subgraphId: string;
    subgraphRevision: number;
    subgraphSchemaRevision: number;
  }>;
  supergraphSdl: string;
};

export async function selectLatestGraphCompositionRevision(
  database: PostgresJsExecutor,
  graphId: string,
): Promise<number> {
  const [composition] = await database
    .select({
      revision: graphCompositions.revision,
    })
    .from(graphCompositions)
    .where(eq(graphCompositions.graphId, graphId))
    .orderBy(desc(graphCompositions.revision))
    .limit(1);

  return (composition?.revision ?? 0) + 1;
}

export async function selectGraphComposition(
  database: PostgresJsExecutor,
  graphId: string,
  revision: number,
): Promise<StoredGraphComposition | undefined> {
  const [composition] = await database
    .select({
      graphId: graphCompositions.graphId,
      revision: graphCompositions.revision,
      supergraphSdl: graphCompositions.supergraphSdl,
      compositionHash: graphCompositions.compositionHash,
      createdAt: graphCompositions.createdAt,
    })
    .from(graphCompositions)
    .where(and(eq(graphCompositions.graphId, graphId), eq(graphCompositions.revision, revision)))
    .limit(1);

  return composition;
}

export async function selectGraphCompositionSchemaRevisions(
  database: PostgresJsExecutor,
  graphId: string,
  revision: number,
): Promise<Map<string, number>> {
  const rows = await database
    .select({
      subgraphId: graphCompositionSubgraphSchemaRevisions.subgraphId,
      subgraphSchemaRevision: graphCompositionSubgraphSchemaRevisions.subgraphSchemaRevision,
    })
    .from(graphCompositionSubgraphSchemaRevisions)
    .where(
      and(
        eq(graphCompositionSubgraphSchemaRevisions.graphId, graphId),
        eq(graphCompositionSubgraphSchemaRevisions.supergraphRevision, revision),
      ),
    );

  return new Map(rows.map((row) => [row.subgraphId, row.subgraphSchemaRevision] as const));
}

export async function insertGraphComposition(
  transaction: PostgresJsTransaction,
  input: StoredGraphCompositionInput,
): Promise<void> {
  await transaction.insert(graphCompositions).values({
    graphId: input.graphId,
    revision: input.revision,
    supergraphSdl: input.supergraphSdl,
    compositionHash: input.compositionHash,
    createdAt: input.createdAt,
  });

  await transaction.insert(graphCompositionGraphRevisions).values({
    graphId: input.graphId,
    supergraphRevision: input.revision,
    graphRevision: input.graphRevision,
  });

  if (input.subgraphs.length > 0) {
    await transaction.insert(graphCompositionSubgraphRevisions).values(
      input.subgraphs.map((subgraph) => ({
        graphId: input.graphId,
        supergraphRevision: input.revision,
        subgraphId: subgraph.subgraphId,
        subgraphRevision: subgraph.subgraphRevision,
      })),
    );

    await transaction.insert(graphCompositionSubgraphSchemaRevisions).values(
      input.subgraphs.map((subgraph) => ({
        graphId: input.graphId,
        supergraphRevision: input.revision,
        subgraphId: subgraph.subgraphId,
        subgraphSchemaRevision: subgraph.subgraphSchemaRevision,
      })),
    );
  }

  await transaction
    .update(graphs)
    .set({
      currentGraphCompositionRevision: input.revision,
    })
    .where(eq(graphs.id, input.graphId));
}

export async function clearCurrentGraphCompositionRevision(
  transaction: PostgresJsTransaction,
  graphId: string,
): Promise<void> {
  await transaction
    .update(graphs)
    .set({
      currentGraphCompositionRevision: null,
    })
    .where(eq(graphs.id, graphId));
}
