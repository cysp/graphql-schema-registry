import { and, asc, eq, isNull } from "drizzle-orm";

import { subgraphRevisions, subgraphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";

// oxlint-disable-next-line typescript-eslint/explicit-module-boundary-types
export function listActiveSubgraphsByGraphId(database: PostgresJsDatabase, graphId: number) {
  return database
    .select({
      id: subgraphs.id,
      externalId: subgraphs.externalId,
      graphId: subgraphs.graphId,
      slug: subgraphs.slug,
      revisionId: subgraphRevisions.revisionId,
      routingUrl: subgraphRevisions.routingUrl,
      createdAt: subgraphs.createdAt,
      updatedAt: subgraphs.updatedAt,
    })
    .from(subgraphs)
    .innerJoin(
      subgraphRevisions,
      and(
        eq(subgraphRevisions.subgraphId, subgraphs.id),
        eq(subgraphRevisions.revisionId, subgraphs.currentRevisionId),
      ),
    )
    .where(and(eq(subgraphs.graphId, graphId), isNull(subgraphs.deletedAt)))
    .orderBy(asc(subgraphs.slug));
}
