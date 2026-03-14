import { and, eq, isNull } from "drizzle-orm";

import { graphRevisions, graphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";

// oxlint-disable-next-line typescript-eslint/explicit-module-boundary-types
export async function getActiveGraphBySlug(database: PostgresJsDatabase, slug: string) {
  const [graphRecord] = await database
    .select({
      id: graphs.id,
      externalId: graphs.externalId,
      slug: graphs.slug,
      revisionId: graphRevisions.revisionId,
      federationVersion: graphRevisions.federationVersion,
      createdAt: graphs.createdAt,
      updatedAt: graphs.updatedAt,
    })
    .from(graphs)
    .innerJoin(
      graphRevisions,
      and(
        eq(graphRevisions.graphId, graphs.id),
        eq(graphRevisions.revisionId, graphs.currentRevisionId),
      ),
    )
    .where(and(eq(graphs.slug, slug), isNull(graphs.deletedAt)))
    .limit(1);

  return graphRecord;
}
