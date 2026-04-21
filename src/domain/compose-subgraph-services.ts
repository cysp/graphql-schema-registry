import { composeServices } from "@apollo/composition";
import { parse } from "graphql";

import type { GraphCompositionEligibleSubgraph } from "./database/types.ts";

type ComposableSubgraphService = Pick<
  GraphCompositionEligibleSubgraph,
  "slug" | "routingUrl" | "normalizedSdl"
>;

export function composeSubgraphServices(
  subgraphDefinitions: ReadonlyArray<ComposableSubgraphService>,
): ReturnType<typeof composeServices> {
  return composeServices(
    subgraphDefinitions.map((definition) => ({
      name: definition.slug,
      typeDefs: parse(definition.normalizedSdl),
      url: definition.routingUrl,
    })),
  );
}
