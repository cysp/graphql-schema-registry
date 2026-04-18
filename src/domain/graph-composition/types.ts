import type { PostgresJsTransaction } from "../../drizzle/types.ts";
import type {
  ActiveGraph,
  GraphCompositionEligibleSubgraph,
  GraphCompositionSubgraphReference,
  StoredGraphCompositionAttempt,
} from "../database/types.ts";

export type GraphCompositionTransaction = PostgresJsTransaction;

export type GraphForComposition = Pick<
  ActiveGraph,
  "id" | "currentCompositionRevision" | "currentSupergraphSchemaRevision"
>;

export type GraphCompositionCandidate = GraphCompositionEligibleSubgraph;

export type GraphCompositionMemberReference = GraphCompositionSubgraphReference;

export type StoredCompositionAttempt = StoredGraphCompositionAttempt;
