import { composeServices } from "@apollo/composition";
import { parse } from "graphql";

import type { GraphCompositionCandidate } from "./types.ts";

export type SupergraphCompositionResult =
  | { errors: ReadonlyArray<unknown>; supergraphSdl?: undefined }
  | { errors?: undefined; supergraphSdl: string };

export interface SupergraphComposer {
  composeCompositionCandidates(
    candidates: ReadonlyArray<GraphCompositionCandidate>,
  ): SupergraphCompositionResult;
}

export function createApolloSupergraphComposer(): SupergraphComposer {
  return {
    composeCompositionCandidates(candidates) {
      const compositionResult = composeServices(
        candidates.map((candidate) => ({
          name: candidate.slug,
          typeDefs: parse(candidate.normalizedSdl),
          url: candidate.routingUrl,
        })),
      );

      if (compositionResult.errors) {
        return { errors: compositionResult.errors };
      }

      return { supergraphSdl: compositionResult.supergraphSdl };
    },
  };
}
