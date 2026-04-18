import {
  clearGraphCompositionPointers,
  insertGraphCompositionAttempt,
  insertSupergraphSchemaAndSetCurrentRevision,
  selectGraphCompositionSubgraphs,
  selectLatestGraphCompositionRevision,
  selectSubgraphsEligibleForGraphComposition,
} from "../database/graph-compositions/repository.ts";
import type {
  GraphCompositionCandidate,
  GraphCompositionMemberReference,
  GraphCompositionTransaction,
  StoredCompositionAttempt,
} from "./types.ts";

export type PublishSupergraphSchemaParams = {
  compositionRevision: bigint;
  createdAt: Date;
  graphId: string;
  supergraphSdl: string;
};

export interface GraphCompositionStore {
  selectCompositionCandidates(
    transaction: GraphCompositionTransaction,
    graphId: string,
  ): Promise<ReadonlyArray<GraphCompositionCandidate>>;

  selectCompositionMembers(
    transaction: GraphCompositionTransaction,
    graphId: string,
    compositionRevision: bigint,
  ): Promise<ReadonlyArray<GraphCompositionMemberReference>>;

  selectLatestCompositionRevision(
    transaction: GraphCompositionTransaction,
    graphId: string,
  ): Promise<bigint | null>;

  insertGraphCompositionAttempt(
    transaction: GraphCompositionTransaction,
    params: {
      createdAt: Date;
      graphId: string;
      nextCompositionRevision: bigint;
      compositionMembers: ReadonlyArray<GraphCompositionMemberReference>;
    },
  ): Promise<StoredCompositionAttempt>;

  publishSupergraphSchema(
    transaction: GraphCompositionTransaction,
    params: PublishSupergraphSchemaParams,
  ): Promise<void>;

  clearCurrentCompositionPointers(
    transaction: GraphCompositionTransaction,
    graphId: string,
  ): Promise<void>;
}

export function createDatabaseGraphCompositionStore(): GraphCompositionStore {
  return {
    async clearCurrentCompositionPointers(transaction, graphId) {
      await clearGraphCompositionPointers(transaction, graphId);
    },

    async insertGraphCompositionAttempt(transaction, params) {
      return insertGraphCompositionAttempt(transaction, {
        createdAt: params.createdAt,
        graphId: params.graphId,
        nextRevision: params.nextCompositionRevision,
        subgraphs: params.compositionMembers,
      });
    },

    async publishSupergraphSchema(transaction, params) {
      await insertSupergraphSchemaAndSetCurrentRevision(transaction, params);
    },

    async selectCompositionCandidates(transaction, graphId) {
      return selectSubgraphsEligibleForGraphComposition(transaction, graphId);
    },

    async selectCompositionMembers(transaction, graphId, compositionRevision) {
      return selectGraphCompositionSubgraphs(transaction, graphId, compositionRevision);
    },

    async selectLatestCompositionRevision(transaction, graphId) {
      return selectLatestGraphCompositionRevision(transaction, graphId);
    },
  };
}
