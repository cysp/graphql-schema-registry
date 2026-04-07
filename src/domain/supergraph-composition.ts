import { createHash } from "node:crypto";

import { composeServices } from "@apollo/composition";
import { GraphQLError, parse } from "graphql";

import type { PostgresJsTransaction } from "../drizzle/types.ts";
import {
  clearCurrentSupergraphSchemaRevision,
  insertSupergraphSchemaRevisionSubgraphs,
  insertSupergraphSchemaRevisionAndSetCurrent,
  selectLatestSupergraphSchemaRevision,
  selectEligibleCompositionSubgraphsByGraphId,
} from "./database/supergraphs/repository.ts";
import type { ActiveGraph, CompositionEligibleSubgraph } from "./database/types.ts";

export type CompositionAttemptOutcome =
  | { kind: "empty" }
  | { kind: "failed"; errors: readonly GraphQLError[] }
  | { kind: "stored"; revision: bigint };

function hashSchemaSdl(schemaSdl: string): string {
  return createHash("sha256").update(schemaSdl).digest("hex");
}

function composeSubgraphs(subgraphs: readonly CompositionEligibleSubgraph[]) {
  try {
    return composeServices(
      subgraphs.map((subgraph) => ({
        name: subgraph.subgraphSlug,
        typeDefs: parse(subgraph.normalizedSdl),
        url: subgraph.routingUrl,
      })),
    );
  } catch (error) {
    if (error instanceof GraphQLError) {
      return { errors: [error] } as const;
    }

    return {
      errors: [new GraphQLError(error instanceof Error ? error.message : "Composition failed.")],
    } as const;
  }
}

export async function composeGraphWithinTransaction(
  transaction: PostgresJsTransaction,
  graph: Pick<ActiveGraph, "id">,
  createdAt: Date,
): Promise<CompositionAttemptOutcome> {
  const subgraphs = await selectEligibleCompositionSubgraphsByGraphId(transaction, graph.id);

  if (subgraphs.length === 0) {
    await clearCurrentSupergraphSchemaRevision(transaction, graph.id);
    return { kind: "empty" };
  }

  const compositionResult = composeSubgraphs(subgraphs);
  if (compositionResult.errors) {
    return {
      kind: "failed",
      errors: compositionResult.errors,
    };
  }

  const latestSupergraph = await selectLatestSupergraphSchemaRevision(transaction, graph.id);
  const nextRevision = (latestSupergraph?.revision ?? 0n) + 1n;
  const schemaHash = hashSchemaSdl(compositionResult.supergraphSdl);

  await insertSupergraphSchemaRevisionAndSetCurrent(transaction, {
    graphId: graph.id,
    revision: nextRevision,
    supergraphSdl: compositionResult.supergraphSdl,
    schemaHash,
    createdAt,
  });

  await insertSupergraphSchemaRevisionSubgraphs(transaction, {
    graphId: graph.id,
    subgraphs,
    supergraphSchemaRevision: nextRevision,
  });

  return { kind: "stored", revision: nextRevision };
}
