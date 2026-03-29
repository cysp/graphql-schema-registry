import { and, asc, eq, isNull, sql } from "drizzle-orm";

import {
  graphCompositionSubgraphs,
  graphCompositions,
  graphRevisions,
  graphs,
  subgraphRevisions,
  subgraphSchemaRevisions,
  subgraphs,
} from "../../drizzle/schema.ts";
import type { PostgresJsExecutor, PostgresJsTransaction } from "../../drizzle/types.ts";
import type { CurrentGraphComposition } from "../database/graph-compositions.ts";
import { composeSupergraph } from "../federation.ts";

type GraphCompositionState = {
  currentCompositionRevision: number | null;
  deletedAt: Date | null;
  federationVersion: string;
  graphId: string;
  graphRevision: number;
};

type CurrentSubgraphCompositionState = {
  id: string;
  revision: number;
  schemaRevision: number | null;
  slug: string;
  normalizedSdl: string | null;
  routingUrl: string;
};

type AttemptGraphCompositionResult =
  | {
      kind: "failure";
    }
  | {
      kind: "skipped";
      reason: "deleted_graph" | "missing_schema" | "no_subgraphs";
    }
  | {
      kind: "success";
      composition: CurrentGraphComposition;
    };

function requireNonNull<Value>(value: Value | null, message: string): Value {
  if (value === null) {
    throw new Error(message);
  }

  return value;
}

function graphRevisionJoinCondition() {
  return and(eq(graphRevisions.graphId, graphs.id), eq(graphRevisions.revision, graphs.revision));
}

function subgraphRevisionJoinCondition() {
  return and(
    eq(subgraphRevisions.subgraphId, subgraphs.id),
    eq(subgraphRevisions.revision, subgraphs.revision),
  );
}

async function selectGraphCompositionState(
  database: PostgresJsExecutor,
  graphId: string,
): Promise<GraphCompositionState | undefined> {
  const [graph] = await database
    .select({
      currentCompositionRevision: graphs.currentCompositionRevision,
      deletedAt: graphs.deletedAt,
      federationVersion: graphRevisions.federationVersion,
      graphId: graphs.id,
      graphRevision: graphRevisions.revision,
    })
    .from(graphs)
    .innerJoin(graphRevisions, graphRevisionJoinCondition())
    .where(eq(graphs.id, graphId))
    .limit(1);

  return graph;
}

async function selectCurrentSubgraphCompositionStates(
  database: PostgresJsExecutor,
  graphId: string,
): Promise<CurrentSubgraphCompositionState[]> {
  const latestSchemaRevisions = database
    .select({
      revision: sql<number>`max(${subgraphSchemaRevisions.revision})`.as("revision"),
      subgraphId: subgraphSchemaRevisions.subgraphId,
    })
    .from(subgraphSchemaRevisions)
    .groupBy(subgraphSchemaRevisions.subgraphId)
    .as("latest_schema_revisions");

  return database
    .select({
      id: subgraphs.id,
      normalizedSdl: subgraphSchemaRevisions.normalizedSdl,
      revision: subgraphRevisions.revision,
      routingUrl: subgraphRevisions.routingUrl,
      schemaRevision: subgraphSchemaRevisions.revision,
      slug: subgraphs.slug,
    })
    .from(subgraphs)
    .innerJoin(subgraphRevisions, subgraphRevisionJoinCondition())
    .leftJoin(latestSchemaRevisions, eq(latestSchemaRevisions.subgraphId, subgraphs.id))
    .leftJoin(
      subgraphSchemaRevisions,
      and(
        eq(subgraphSchemaRevisions.subgraphId, subgraphs.id),
        eq(subgraphSchemaRevisions.revision, latestSchemaRevisions.revision),
      ),
    )
    .where(and(eq(subgraphs.graphId, graphId), isNull(subgraphs.deletedAt)))
    .orderBy(asc(subgraphs.slug));
}

async function insertGraphComposition(
  transaction: PostgresJsTransaction,
  input: {
    graphId: string;
    graphRevision: number;
    now: Date;
    subgraphs: ReadonlyArray<CurrentSubgraphCompositionState>;
    supergraphSdl: string;
  },
): Promise<CurrentGraphComposition> {
  const [latestComposition] = await transaction
    .select({
      revision: sql<number>`max(${graphCompositions.revision})`.as("revision"),
    })
    .from(graphCompositions)
    .where(eq(graphCompositions.graphId, input.graphId));
  const revision = (latestComposition?.revision ?? 0) + 1;

  const [composition] = await transaction
    .insert(graphCompositions)
    .values({
      createdAt: input.now,
      graphId: input.graphId,
      graphRevision: input.graphRevision,
      revision,
      supergraphSdl: input.supergraphSdl,
    })
    .returning();

  if (!composition) {
    throw new Error("Graph composition insert did not return a row.");
  }

  await transaction.insert(graphCompositionSubgraphs).values(
    input.subgraphs.map((subgraph) => ({
      compositionRevision: revision,
      graphId: input.graphId,
      subgraphId: subgraph.id,
      subgraphRevision: subgraph.revision,
      subgraphSchemaRevision: requireNonNull(
        subgraph.schemaRevision,
        "Composed subgraph is missing a schema revision.",
      ),
    })),
  );

  await transaction
    .update(graphs)
    .set({
      currentCompositionRevision: revision,
      updatedAt: input.now,
    })
    .where(eq(graphs.id, input.graphId));

  return composition;
}

async function clearCurrentGraphComposition(
  transaction: PostgresJsTransaction,
  graphId: string,
  now: Date,
): Promise<void> {
  await transaction
    .update(graphs)
    .set({
      currentCompositionRevision: null,
      updatedAt: now,
    })
    .where(eq(graphs.id, graphId));
}

export async function attemptGraphComposition(
  transaction: PostgresJsTransaction,
  graphId: string,
  now: Date,
): Promise<AttemptGraphCompositionResult> {
  const graph = await selectGraphCompositionState(transaction, graphId);
  if (!graph || graph.deletedAt) {
    await clearCurrentGraphComposition(transaction, graphId, now);

    return {
      kind: "skipped",
      reason: "deleted_graph",
    };
  }

  const subgraphStates = await selectCurrentSubgraphCompositionStates(transaction, graphId);
  if (subgraphStates.length === 0) {
    await clearCurrentGraphComposition(transaction, graphId, now);

    return {
      kind: "skipped",
      reason: "no_subgraphs",
    };
  }

  if (
    subgraphStates.some(
      (subgraphState) =>
        subgraphState.schemaRevision === null || subgraphState.normalizedSdl === null,
    )
  ) {
    return {
      kind: "skipped",
      reason: "missing_schema",
    };
  }

  const composition = composeSupergraph({
    federationVersion: graph.federationVersion,
    subgraphs: subgraphStates.map((subgraphState) => ({
      name: subgraphState.slug,
      sdl: requireNonNull(subgraphState.normalizedSdl, "Composed subgraph SDL is missing."),
      url: subgraphState.routingUrl,
    })),
  });

  if (composition.kind === "failure") {
    return composition;
  }

  return {
    kind: "success",
    composition: await insertGraphComposition(transaction, {
      graphId,
      graphRevision: graph.graphRevision,
      now,
      subgraphs: subgraphStates,
      supergraphSdl: composition.supergraphSdl,
    }),
  };
}
