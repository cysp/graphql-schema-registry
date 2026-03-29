import { and, eq, sql } from "drizzle-orm";

import { graphCompositionSubgraphs, graphCompositions } from "../../drizzle/schema.ts";
import type { PostgresJsExecutor } from "../../drizzle/types.ts";

export type CurrentGraphComposition = {
  graphId: string;
  graphRevision: number;
  revision: number;
  supergraphSdl: string;
  createdAt: Date;
};

export async function selectCurrentGraphCompositionByGraphId(
  database: PostgresJsExecutor,
  graphId: string,
  currentCompositionRevision: number,
): Promise<CurrentGraphComposition | undefined> {
  const [composition] = await database
    .select({
      graphId: graphCompositions.graphId,
      graphRevision: graphCompositions.graphRevision,
      revision: graphCompositions.revision,
      supergraphSdl: graphCompositions.supergraphSdl,
      createdAt: graphCompositions.createdAt,
    })
    .from(graphCompositions)
    .where(
      and(
        eq(graphCompositions.graphId, graphId),
        eq(graphCompositions.revision, currentCompositionRevision),
      ),
    )
    .limit(1);

  return composition;
}

export async function selectGraphCompositionConstituentsCount(
  database: PostgresJsExecutor,
  graphId: string,
  compositionRevision: number,
): Promise<number> {
  const [row] = await database
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(graphCompositionSubgraphs)
    .where(
      and(
        eq(graphCompositionSubgraphs.graphId, graphId),
        eq(graphCompositionSubgraphs.compositionRevision, compositionRevision),
      ),
    );

  return row?.count ?? 0;
}
