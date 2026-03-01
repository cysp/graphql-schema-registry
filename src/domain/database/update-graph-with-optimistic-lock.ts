import { and, eq, isNull } from "drizzle-orm";

import { graphRevisions, graphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";

type UpdateGraphWithOptimisticLockInput = Readonly<{
  currentRevisionId: number;
  federationVersion: string;
  graphId: number;
  now: Date;
}>;

// oxlint-disable-next-line typescript-eslint/explicit-module-boundary-types
export async function updateGraphWithOptimisticLockInTransaction(
  database: PostgresJsDatabase,
  {
    currentRevisionId,
    federationVersion,
    graphId,
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
      createdAt: graphs.createdAt,
      externalId: graphs.externalId,
      id: graphs.id,
      slug: graphs.slug,
      updatedAt: graphs.updatedAt,
    });

  if (!updatedGraphRecord) {
    return;
  }

  await database.insert(graphRevisions).values({
    createdAt: now,
    federationVersion,
    graphId: updatedGraphRecord.id,
    revisionId: nextRevisionId,
  });

  return {
    createdAt: updatedGraphRecord.createdAt,
    externalId: updatedGraphRecord.externalId,
    federationVersion,
    id: updatedGraphRecord.id,
    revisionId: nextRevisionId,
    slug: updatedGraphRecord.slug,
    updatedAt: updatedGraphRecord.updatedAt,
  };
}
