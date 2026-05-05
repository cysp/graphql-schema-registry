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
import type { ActiveGraph, GraphCompositionSubgraphReference } from "./database/types.ts";

type GraphForComposition = Pick<
  ActiveGraph,
  "id" | "currentCompositionRevision" | "currentSupergraphSchemaRevision"
>;

function compositionMembersMatch(
  left: ReadonlyArray<GraphCompositionSubgraphReference>,
  right: ReadonlyArray<GraphCompositionSubgraphReference>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const leftKeys = left
    .map(
      (member) =>
        `${member.subgraphId}:${member.subgraphRevision}:${member.subgraphSchemaRevision}`,
    )
    .toSorted();
  const rightKeys = right
    .map(
      (member) =>
        `${member.subgraphId}:${member.subgraphRevision}:${member.subgraphSchemaRevision}`,
    )
    .toSorted();

  return leftKeys.every((key, index) => key === rightKeys[index]);
}

export async function attemptGraphComposition(
  transaction: PostgresJsTransaction,
  graph: GraphForComposition,
  createdAt: Date,
): Promise<void> {
  const compositionCandidates = await selectSubgraphsEligibleForGraphComposition(
    transaction,
    graph.id,
  );
  const compositionMembers = compositionCandidates.map((candidate) => ({
    subgraphId: candidate.subgraphId,
    subgraphRevision: candidate.subgraphRevision,
    subgraphSchemaRevision: candidate.subgraphSchemaRevision,
  }));

  if (compositionMembers.length === 0) {
    if (
      graph.currentCompositionRevision !== null ||
      graph.currentSupergraphSchemaRevision !== null
    ) {
      await clearGraphCompositionPointers(transaction, graph.id);
    }
    return;
  }

  if (graph.currentCompositionRevision !== null) {
    const currentCompositionMembers = await selectGraphCompositionSubgraphs(
      transaction,
      graph.id,
      graph.currentCompositionRevision,
    );
    if (compositionMembersMatch(currentCompositionMembers, compositionMembers)) {
      return;
    }
  }

  const latestCompositionRevision = await selectLatestGraphCompositionRevision(
    transaction,
    graph.id,
  );
  const nextCompositionRevision = (latestCompositionRevision ?? 0n) + 1n;
  const result = composeServices(
    compositionCandidates.map((candidate) => ({
      name: candidate.slug,
      typeDefs: parse(candidate.normalizedSdl),
      url: candidate.routingUrl,
    })),
  );
  const compositionRevision = await insertGraphCompositionAttempt(transaction, {
    createdAt,
    graphId: graph.id,
    nextCompositionRevision,
    compositionMembers,
  });

  if (result.errors) {
    return;
  }

  await insertSupergraphSchemaAndSetCurrentRevision(transaction, {
    compositionRevision,
    createdAt,
    graphId: graph.id,
    supergraphSdl: result.supergraphSdl,
  });
}
