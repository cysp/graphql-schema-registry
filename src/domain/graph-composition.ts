import { composeServices } from "@apollo/composition";
import { parse } from "graphql";

import type { PostgresJsTransaction } from "../drizzle/types.ts";
import {
  clearGraphCompositionPointers,
  insertGraphCompositionAttempt,
  insertSupergraphSchemaAndSetCurrentRevision,
  selectGraphCompositionSubgraphs,
  selectLatestGraphCompositionRevision,
  selectSubgraphsEligibleForGraphComposition,
} from "./database/graph-compositions/repository.ts";
import type {
  ActiveGraph,
  GraphCompositionSubgraphReference,
  GraphCompositionEligibleSubgraph,
} from "./database/types.ts";

function toCompositionSubgraphReferences(
  subgraphs: ReadonlyArray<GraphCompositionEligibleSubgraph>,
): GraphCompositionSubgraphReference[] {
  return subgraphs.map((member) => ({
    subgraphId: member.subgraphId,
    subgraphRevision: member.subgraphRevision,
    subgraphSchemaRevision: member.subgraphSchemaRevision,
  }));
}

function subgraphReferenceListsAreEqual(
  left: ReadonlyArray<GraphCompositionSubgraphReference>,
  right: ReadonlyArray<GraphCompositionSubgraphReference>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const leftSorted = left.toSorted((first, second) =>
    first.subgraphId.localeCompare(second.subgraphId),
  );
  const rightSorted = right.toSorted((first, second) =>
    first.subgraphId.localeCompare(second.subgraphId),
  );

  return leftSorted.every((member, index) => {
    const other = rightSorted[index];
    return (
      other !== undefined &&
      member.subgraphId === other.subgraphId &&
      member.subgraphRevision === other.subgraphRevision &&
      member.subgraphSchemaRevision === other.subgraphSchemaRevision
    );
  });
}

function graphHasCompositionPointers(
  graph: Pick<ActiveGraph, "currentCompositionRevision" | "currentSupergraphSchemaRevision">,
): boolean {
  return (
    graph.currentCompositionRevision !== null || graph.currentSupergraphSchemaRevision !== null
  );
}

function composeEligibleSubgraphs(subgraphs: ReadonlyArray<GraphCompositionEligibleSubgraph>) {
  return composeServices(
    subgraphs.map((member) => ({
      name: member.slug,
      typeDefs: parse(member.normalizedSdl),
      url: member.routingUrl,
    })),
  );
}

export async function attemptGraphComposition(
  transaction: PostgresJsTransaction,
  graph: Pick<ActiveGraph, "id" | "currentCompositionRevision" | "currentSupergraphSchemaRevision">,
  createdAt: Date,
): Promise<void> {
  const eligibleSubgraphs = await selectSubgraphsEligibleForGraphComposition(transaction, graph.id);
  const eligibleSubgraphReferences = toCompositionSubgraphReferences(eligibleSubgraphs);

  if (eligibleSubgraphReferences.length === 0) {
    if (graphHasCompositionPointers(graph)) {
      await clearGraphCompositionPointers(transaction, graph.id);
    }
    return;
  }

  if (graph.currentCompositionRevision !== null) {
    const latestCompositionSubgraphReferences = await selectGraphCompositionSubgraphs(
      transaction,
      graph.id,
      graph.currentCompositionRevision,
    );
    if (
      subgraphReferenceListsAreEqual(
        latestCompositionSubgraphReferences,
        eligibleSubgraphReferences,
      )
    ) {
      return;
    }
  }

  const latestRevision = await selectLatestGraphCompositionRevision(transaction, graph.id);
  const nextRevision = (latestRevision ?? 0n) + 1n;
  const compositionResult = composeEligibleSubgraphs(eligibleSubgraphs);

  const storedGraphCompositionAttempt = await insertGraphCompositionAttempt(transaction, {
    createdAt,
    graphId: graph.id,
    nextRevision,
    subgraphs: eligibleSubgraphReferences,
  });

  if (compositionResult.errors) {
    return;
  }

  await insertSupergraphSchemaAndSetCurrentRevision(transaction, {
    compositionRevision: storedGraphCompositionAttempt.revision,
    createdAt,
    graphId: graph.id,
    supergraphSdl: compositionResult.supergraphSdl,
  });
}
