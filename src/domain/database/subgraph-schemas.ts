import { desc, eq } from "drizzle-orm";

import { subgraphSchemaRevisions } from "../../drizzle/schema.ts";
import type { PostgresJsTransaction } from "../../drizzle/types.ts";
import { attemptGraphComposition } from "../composition/attempt-graph-composition.ts";
import { validateSubgraphSchema } from "../federation.ts";
import type { ActiveGraph, ActiveSubgraph } from "./types.ts";

type PublishSubgraphSchemaInput = {
  graph: ActiveGraph;
  subgraph: ActiveSubgraph;
  rawSdl: string;
  now: Date;
};

type PublishSubgraphSchemaResult =
  | {
      kind: "invalid_schema";
    }
  | {
      kind: "noop";
      revision: number;
    }
  | {
      kind: "published";
      revision: number;
    };

type CurrentSubgraphSchema = {
  normalizedHash: string;
  revision: number;
};

export async function selectCurrentSchemaRevision(
  transaction: PostgresJsTransaction,
  subgraphId: string,
): Promise<CurrentSubgraphSchema | undefined> {
  const [schemaRevision] = await transaction
    .select({
      normalizedHash: subgraphSchemaRevisions.normalizedHash,
      revision: subgraphSchemaRevisions.revision,
    })
    .from(subgraphSchemaRevisions)
    .where(eq(subgraphSchemaRevisions.subgraphId, subgraphId))
    .orderBy(desc(subgraphSchemaRevisions.revision))
    .limit(1);

  return schemaRevision;
}

export async function publishSubgraphSchemaInTransaction(
  transaction: PostgresJsTransaction,
  input: PublishSubgraphSchemaInput,
): Promise<PublishSubgraphSchemaResult> {
  const validatedSchema = validateSubgraphSchema(
    input.subgraph.slug,
    input.subgraph.routingUrl,
    input.rawSdl,
  );
  if (!validatedSchema.ok) {
    return {
      kind: "invalid_schema",
    };
  }

  const currentSchema = await selectCurrentSchemaRevision(transaction, input.subgraph.id);
  if (currentSchema?.normalizedHash === validatedSchema.value.normalizedHash) {
    return {
      kind: "noop",
      revision: currentSchema.revision,
    };
  }

  const nextRevision = (currentSchema?.revision ?? 0) + 1;
  await transaction.insert(subgraphSchemaRevisions).values({
    createdAt: input.now,
    normalizedHash: validatedSchema.value.normalizedHash,
    normalizedSdl: validatedSchema.value.normalizedSdl,
    revision: nextRevision,
    subgraphId: input.subgraph.id,
  });

  await attemptGraphComposition(transaction, input.graph.id, input.now);

  return {
    kind: "published",
    revision: nextRevision,
  };
}
