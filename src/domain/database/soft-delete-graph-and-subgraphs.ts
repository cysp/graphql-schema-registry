import { and, eq, isNull } from "drizzle-orm";

import { graphs, subgraphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";

type SoftDeleteGraphAndSubgraphsInput = Readonly<{
  now: Date;
  slug: string;
}>;

export async function softDeleteGraphAndSubgraphsInTransaction(
  database: PostgresJsDatabase,
  { now, slug }: SoftDeleteGraphAndSubgraphsInput,
): Promise<void> {
  const [deletedGraphRecord] = await database
    .update(graphs)
    .set({
      deletedAt: now,
      updatedAt: now,
    })
    .where(and(eq(graphs.slug, slug), isNull(graphs.deletedAt)))
    .returning({
      id: graphs.id,
    });

  if (!deletedGraphRecord) {
    return;
  }

  await database
    .update(subgraphs)
    .set({
      deletedAt: now,
      updatedAt: now,
    })
    .where(and(eq(subgraphs.graphId, deletedGraphRecord.id), isNull(subgraphs.deletedAt)));
}
