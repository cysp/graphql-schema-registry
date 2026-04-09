import { and, eq, isNull } from "drizzle-orm";

import { subgraphSchemaRevisions, subgraphs } from "../../../drizzle/schema.ts";
import type { PostgresJsExecutor, PostgresJsTransaction } from "../../../drizzle/types.ts";
import type { StoredSubgraphSchemaRevision } from "../types.ts";

export async function selectCurrentSubgraphSchemaRevision(
  database: PostgresJsExecutor,
  subgraphId: string,
): Promise<StoredSubgraphSchemaRevision | undefined> {
  const [revision] = await database
    .select({
      subgraphId: subgraphSchemaRevisions.subgraphId,
      revision: subgraphSchemaRevisions.revision,
      normalizedSdlSha256: subgraphSchemaRevisions.normalizedSdlSha256,
      normalizedSdl: subgraphSchemaRevisions.normalizedSdl,
      createdAt: subgraphSchemaRevisions.createdAt,
    })
    .from(subgraphs)
    .innerJoin(
      subgraphSchemaRevisions,
      and(
        eq(subgraphSchemaRevisions.subgraphId, subgraphs.id),
        eq(subgraphSchemaRevisions.revision, subgraphs.currentSchemaRevision),
      ),
    )
    .where(and(eq(subgraphs.id, subgraphId), isNull(subgraphs.deletedAt)))
    .limit(1);

  return revision;
}

export async function insertSubgraphSchemaRevisionAndSetCurrent(
  transaction: PostgresJsTransaction,
  {
    createdAt,
    normalizedSdl,
    revision,
    subgraphId,
  }: {
    createdAt: Date;
    normalizedSdl: string;
    revision: bigint;
    subgraphId: string;
  },
): Promise<StoredSubgraphSchemaRevision> {
  const [subgraphSchemaRevision] = await transaction
    .insert(subgraphSchemaRevisions)
    .values({
      subgraphId,
      revision,
      normalizedSdl,
      createdAt,
    })
    .returning({
      subgraphId: subgraphSchemaRevisions.subgraphId,
      revision: subgraphSchemaRevisions.revision,
      normalizedSdlSha256: subgraphSchemaRevisions.normalizedSdlSha256,
      normalizedSdl: subgraphSchemaRevisions.normalizedSdl,
      createdAt: subgraphSchemaRevisions.createdAt,
    });

  if (!subgraphSchemaRevision) {
    throw new Error("Subgraph schema revision insert did not return a row.");
  }

  const [updatedSubgraph] = await transaction
    .update(subgraphs)
    .set({
      currentSchemaRevision: revision,
    })
    .where(and(eq(subgraphs.id, subgraphId), isNull(subgraphs.deletedAt)))
    .returning({ id: subgraphs.id });

  if (!updatedSubgraph) {
    throw new Error("Subgraph schema pointer update did not return the locked row.");
  }

  return subgraphSchemaRevision;
}
