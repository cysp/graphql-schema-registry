import { and, asc, eq, isNull } from "drizzle-orm";

import { graphRevisions, graphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";

// oxlint-disable-next-line typescript-eslint/explicit-module-boundary-types
export function listActiveGraphs(database: PostgresJsDatabase) {
  return database
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
    .where(isNull(graphs.deletedAt))
    .orderBy(asc(graphs.slug));
}
