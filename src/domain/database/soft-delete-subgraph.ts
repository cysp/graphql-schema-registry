import { and, eq, isNull } from "drizzle-orm";

import { subgraphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";

type SoftDeleteSubgraphInput = Readonly<{
  subgraphId: number;
  now: Date;
}>;

export async function softDeleteSubgraphInTransaction(
  database: PostgresJsDatabase,
  { subgraphId, now }: SoftDeleteSubgraphInput,
): Promise<boolean> {
  const [deletedSubgraphRecord] = await database
    .update(subgraphs)
    .set({
      updatedAt: now,
      deletedAt: now,
    })
    .where(and(eq(subgraphs.id, subgraphId), isNull(subgraphs.deletedAt)))
    .returning({
      id: subgraphs.id,
    });

  return Boolean(deletedSubgraphRecord);
}
