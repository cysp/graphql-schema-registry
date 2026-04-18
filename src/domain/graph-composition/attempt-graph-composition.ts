import {
  createDatabaseGraphCompositionStore,
  type GraphCompositionStore,
} from "./graph-composition-store.ts";
import {
  createApolloSupergraphComposer,
  type SupergraphComposer,
  type SupergraphCompositionResult,
} from "./supergraph-composer.ts";
import type {
  GraphCompositionCandidate,
  GraphCompositionMemberReference,
  GraphCompositionTransaction,
  GraphForComposition,
} from "./types.ts";

export type AttemptGraphCompositionDependencies = {
  graphCompositionStore: GraphCompositionStore;
  supergraphComposer: SupergraphComposer;
};

const defaultAttemptGraphCompositionDependencies: AttemptGraphCompositionDependencies = {
  graphCompositionStore: createDatabaseGraphCompositionStore(),
  supergraphComposer: createApolloSupergraphComposer(),
};

export function buildCompositionMemberReferences(
  compositionCandidates: ReadonlyArray<GraphCompositionCandidate>,
): GraphCompositionMemberReference[] {
  return compositionCandidates.map((candidate) => ({
    subgraphId: candidate.subgraphId,
    subgraphRevision: candidate.subgraphRevision,
    subgraphSchemaRevision: candidate.subgraphSchemaRevision,
  }));
}

export function compositionMemberReferencesEqual(
  left: ReadonlyArray<GraphCompositionMemberReference>,
  right: ReadonlyArray<GraphCompositionMemberReference>,
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

export function graphHasCurrentCompositionPointers(
  graph: Pick<
    GraphForComposition,
    "currentCompositionRevision" | "currentSupergraphSchemaRevision"
  >,
): boolean {
  return (
    graph.currentCompositionRevision !== null || graph.currentSupergraphSchemaRevision !== null
  );
}

export function composeCompositionCandidates(
  supergraphComposer: SupergraphComposer,
  compositionCandidates: ReadonlyArray<GraphCompositionCandidate>,
): SupergraphCompositionResult {
  return supergraphComposer.composeCompositionCandidates(compositionCandidates);
}

export async function attemptGraphComposition(
  transaction: GraphCompositionTransaction,
  graph: GraphForComposition,
  createdAt: Date,
  dependencies: AttemptGraphCompositionDependencies = defaultAttemptGraphCompositionDependencies,
): Promise<void> {
  const { graphCompositionStore, supergraphComposer } = dependencies;
  const compositionCandidates = await graphCompositionStore.selectCompositionCandidates(
    transaction,
    graph.id,
  );
  const compositionMemberReferences = buildCompositionMemberReferences(compositionCandidates);

  if (compositionMemberReferences.length === 0) {
    if (graphHasCurrentCompositionPointers(graph)) {
      await graphCompositionStore.clearCurrentCompositionPointers(transaction, graph.id);
    }
    return;
  }

  if (graph.currentCompositionRevision !== null) {
    const latestCompositionMembers = await graphCompositionStore.selectCompositionMembers(
      transaction,
      graph.id,
      graph.currentCompositionRevision,
    );
    if (compositionMemberReferencesEqual(latestCompositionMembers, compositionMemberReferences)) {
      return;
    }
  }

  const latestCompositionRevision = await graphCompositionStore.selectLatestCompositionRevision(
    transaction,
    graph.id,
  );
  const nextCompositionRevision = (latestCompositionRevision ?? 0n) + 1n;
  const compositionResult = composeCompositionCandidates(supergraphComposer, compositionCandidates);

  const storedCompositionAttempt = await graphCompositionStore.insertGraphCompositionAttempt(
    transaction,
    {
      compositionMembers: compositionMemberReferences,
      createdAt,
      graphId: graph.id,
      nextCompositionRevision,
    },
  );

  if (compositionResult.errors) {
    return;
  }

  await graphCompositionStore.publishSupergraphSchema(transaction, {
    compositionRevision: storedCompositionAttempt.revision,
    createdAt,
    graphId: graph.id,
    supergraphSdl: compositionResult.supergraphSdl,
  });
}
