import { and, asc, desc, eq, isNull } from "drizzle-orm";

import {
  graphCompositionSubgraphs,
  graphCompositions,
  graphs,
  subgraphRevisions,
  subgraphSchemaRevisions,
  subgraphs,
  supergraphSchemas,
} from "../../../drizzle/schema.ts";
import type { PostgresJsExecutor, PostgresJsTransaction } from "../../../drizzle/types.ts";
import type {
  GraphCompositionSubgraphReference,
  GraphCompositionEligibleSubgraph,
  StoredGraphCompositionAttempt,
  StoredSupergraphSchema,
} from "../types.ts";

export async function selectLatestGraphCompositionRevision(
  database: PostgresJsExecutor,
  graphId: string,
): Promise<bigint | null> {
  const [latestComposition] = await database
    .select({ revision: graphCompositions.revision })
    .from(graphCompositions)
    .where(eq(graphCompositions.graphId, graphId))
    .orderBy(desc(graphCompositions.revision))
    .limit(1);

  return latestComposition?.revision ?? null;
}

export async function selectGraphCompositionSubgraphs(
  database: PostgresJsExecutor,
  graphId: string,
  graphCompositionRevision: bigint,
): Promise<GraphCompositionSubgraphReference[]> {
  return database
    .select({
      subgraphId: graphCompositionSubgraphs.subgraphId,
      subgraphRevision: graphCompositionSubgraphs.subgraphRevision,
      subgraphSchemaRevision: graphCompositionSubgraphs.subgraphSchemaRevision,
    })
    .from(graphCompositionSubgraphs)
    .where(
      and(
        eq(graphCompositionSubgraphs.graphId, graphId),
        eq(graphCompositionSubgraphs.compositionRevision, graphCompositionRevision),
      ),
    )
    .orderBy(asc(graphCompositionSubgraphs.subgraphId));
}

export async function selectSubgraphsEligibleForGraphComposition(
  database: PostgresJsExecutor,
  graphId: string,
): Promise<GraphCompositionEligibleSubgraph[]> {
  return database
    .select({
      subgraphId: subgraphs.id,
      slug: subgraphs.slug,
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
    .orderBy(asc(subgraphs.slug), asc(subgraphs.id));
}

export async function insertGraphCompositionAttempt(
  transaction: PostgresJsTransaction,
  {
    createdAt,
    graphId,
    nextRevision,
    subgraphs,
  }: {
    createdAt: Date;
    graphId: string;
    nextRevision: bigint;
    subgraphs: ReadonlyArray<GraphCompositionSubgraphReference>;
  },
): Promise<StoredGraphCompositionAttempt> {
  const [storedGraphComposition] = await transaction
    .insert(graphCompositions)
    .values({
      graphId,
      revision: nextRevision,
      createdAt,
    })
    .returning({
      graphId: graphCompositions.graphId,
      revision: graphCompositions.revision,
      createdAt: graphCompositions.createdAt,
    });

  if (!storedGraphComposition) {
    throw new Error("Graph composition insert did not return a row.");
  }

  const [updatedGraph] = await transaction
    .update(graphs)
    .set({
      currentCompositionRevision: storedGraphComposition.revision,
    })
    .where(and(eq(graphs.id, graphId), isNull(graphs.deletedAt)))
    .returning({ id: graphs.id });

  if (!updatedGraph) {
    throw new Error("Graph latest composition pointer update did not return the locked row.");
  }

  await transaction.insert(graphCompositionSubgraphs).values(
    subgraphs.map((subgraph) => ({
      graphId,
      compositionRevision: storedGraphComposition.revision,
      subgraphId: subgraph.subgraphId,
      subgraphRevision: subgraph.subgraphRevision,
      subgraphSchemaRevision: subgraph.subgraphSchemaRevision,
    })),
  );

  return storedGraphComposition;
}

export async function insertSupergraphSchemaAndSetCurrentRevision(
  transaction: PostgresJsTransaction,
  {
    compositionRevision,
    createdAt,
    graphId,
    supergraphSdl,
  }: {
    compositionRevision: bigint;
    createdAt: Date;
    graphId: string;
    supergraphSdl: string;
  },
): Promise<StoredSupergraphSchema> {
  const [storedSupergraphSchema] = await transaction
    .insert(supergraphSchemas)
    .values({
      compositionRevision,
      createdAt,
      graphId,
      supergraphSdl,
    })
    .returning({
      graphId: supergraphSchemas.graphId,
      compositionRevision: supergraphSchemas.compositionRevision,
      supergraphSdlSha256: supergraphSchemas.supergraphSdlSha256,
      supergraphSdl: supergraphSchemas.supergraphSdl,
      createdAt: supergraphSchemas.createdAt,
    });

  if (!storedSupergraphSchema) {
    throw new Error("Supergraph schema insert did not return a row.");
  }

  const [updatedGraph] = await transaction
    .update(graphs)
    .set({
      currentSupergraphSchemaRevision: compositionRevision,
    })
    .where(and(eq(graphs.id, graphId), isNull(graphs.deletedAt)))
    .returning({ id: graphs.id });

  if (!updatedGraph) {
    throw new Error(
      "Graph current supergraph schema pointer update did not return the locked row.",
    );
  }

  return storedSupergraphSchema;
}

export async function clearGraphCompositionPointers(
  transaction: PostgresJsTransaction,
  graphId: string,
): Promise<void> {
  const [updatedGraph] = await transaction
    .update(graphs)
    .set({
      currentCompositionRevision: null,
      currentSupergraphSchemaRevision: null,
    })
    .where(and(eq(graphs.id, graphId), isNull(graphs.deletedAt)))
    .returning({ id: graphs.id });

  if (!updatedGraph) {
    throw new Error("Graph composition pointers clear did not return the updated row.");
  }
}
