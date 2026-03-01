import { and, eq, isNull } from "drizzle-orm";

import { graphs, subgraphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";

type SoftDeleteGraphAndSubgraphsInput = Readonly<{
  graphId: number;
  now: Date;
}>;

export async function softDeleteGraphAndSubgraphsInTransaction(
  database: PostgresJsDatabase,
  { graphId, now }: SoftDeleteGraphAndSubgraphsInput,
): Promise<boolean> {
  const [deletedGraphRecord] = await database
    .update(graphs)
    .set({
      updatedAt: now,
      deletedAt: now,
    })
    .where(and(eq(graphs.id, graphId), isNull(graphs.deletedAt)))
    .returning({
      id: graphs.id,
    });

  if (!deletedGraphRecord) {
    return false;
  }

  await database
    .update(subgraphs)
    .set({
      updatedAt: now,
      deletedAt: now,
    })
    .where(and(eq(subgraphs.graphId, deletedGraphRecord.id), isNull(subgraphs.deletedAt)));

  return true;
}
