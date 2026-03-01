import { and, eq, isNull } from "drizzle-orm";

import { graphRevisions, graphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";

type UpdateGraphWithOptimisticLockInput = Readonly<{
  graphId: number;
  currentRevisionId: number;
  federationVersion: string;
  now: Date;
}>;

// oxlint-disable-next-line typescript-eslint/explicit-module-boundary-types
export async function updateGraphWithOptimisticLockInTransaction(
  database: PostgresJsDatabase,
  {
    graphId,
    currentRevisionId,
    federationVersion,
    now,
  }: UpdateGraphWithOptimisticLockInput,
) {
  const nextRevisionId = currentRevisionId + 1;
  const [updatedGraphRecord] = await database
    .update(graphs)
    .set({
      currentRevisionId: nextRevisionId,
      updatedAt: now,
    })
    .where(
      and(
        eq(graphs.id, graphId),
        isNull(graphs.deletedAt),
        eq(graphs.currentRevisionId, currentRevisionId),
      ),
    )
    .returning({
      id: graphs.id,
      externalId: graphs.externalId,
      slug: graphs.slug,
      createdAt: graphs.createdAt,
      updatedAt: graphs.updatedAt,
    });

  if (!updatedGraphRecord) {
    return;
  }

  await database.insert(graphRevisions).values({
    graphId: updatedGraphRecord.id,
    revisionId: nextRevisionId,
    federationVersion,
    createdAt: now,
  });

  return {
    id: updatedGraphRecord.id,
    externalId: updatedGraphRecord.externalId,
    slug: updatedGraphRecord.slug,
    revisionId: nextRevisionId,
    federationVersion,
    createdAt: updatedGraphRecord.createdAt,
    updatedAt: updatedGraphRecord.updatedAt,
  };
}
