import { and, asc, eq, isNull } from "drizzle-orm";

import { graphRevisions, graphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";

// oxlint-disable-next-line typescript-eslint/explicit-module-boundary-types
export function listActiveGraphs(database: PostgresJsDatabase) {
  return database
    .select({
      createdAt: graphs.createdAt,
      externalId: graphs.externalId,
      federationVersion: graphRevisions.federationVersion,
      id: graphs.id,
      revisionId: graphRevisions.revisionId,
      slug: graphs.slug,
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
    .where(isNull(graphs.deletedAt))
    .orderBy(asc(graphs.slug));
}
