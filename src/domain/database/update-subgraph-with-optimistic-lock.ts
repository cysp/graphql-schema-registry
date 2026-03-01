import { and, eq, isNull } from "drizzle-orm";

import { subgraphRevisions, subgraphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";

type UpdateSubgraphWithOptimisticLockInput = Readonly<{
  subgraphId: number;
  currentRevisionId: number;
  routingUrl: string;
  now: Date;
}>;

// oxlint-disable-next-line typescript-eslint/explicit-module-boundary-types
export async function updateSubgraphWithOptimisticLockInTransaction(
  database: PostgresJsDatabase,
  { subgraphId, currentRevisionId, routingUrl, now }: UpdateSubgraphWithOptimisticLockInput,
) {
  const nextRevisionId = currentRevisionId + 1;
  const [updatedSubgraphRecord] = await database
    .update(subgraphs)
    .set({
      currentRevisionId: nextRevisionId,
      updatedAt: now,
    })
    .where(
      and(
        eq(subgraphs.id, subgraphId),
        isNull(subgraphs.deletedAt),
        eq(subgraphs.currentRevisionId, currentRevisionId),
      ),
    )
    .returning({
      id: subgraphs.id,
      externalId: subgraphs.externalId,
      graphId: subgraphs.graphId,
      slug: subgraphs.slug,
      createdAt: subgraphs.createdAt,
      updatedAt: subgraphs.updatedAt,
    });

  if (!updatedSubgraphRecord) {
    return;
  }

  await database.insert(subgraphRevisions).values({
    subgraphId: updatedSubgraphRecord.id,
    revisionId: nextRevisionId,
    routingUrl,
    createdAt: now,
  });

  return {
    id: updatedSubgraphRecord.id,
    externalId: updatedSubgraphRecord.externalId,
    graphId: updatedSubgraphRecord.graphId,
    slug: updatedSubgraphRecord.slug,
    revisionId: nextRevisionId,
    routingUrl,
    createdAt: updatedSubgraphRecord.createdAt,
    updatedAt: updatedSubgraphRecord.updatedAt,
  };
}
