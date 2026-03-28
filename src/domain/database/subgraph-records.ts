import { and, asc, eq, isNull } from "drizzle-orm";

import { graphs, subgraphRevisions, subgraphs } from "../../drizzle/schema.ts";
import type { PostgresJsExecutor } from "../../drizzle/types.ts";

export type ActiveSubgraph = {
  createdAt: Date;
  graphId: string;
  id: string;
  revision: number;
  routingUrl: string;
  slug: string;
  updatedAt: Date;
};

function subgraphRevisionJoinCondition() {
  return and(
    eq(subgraphRevisions.subgraphId, subgraphs.id),
    eq(subgraphRevisions.revision, subgraphs.revision),
  );
}

function selectSubgraphWithRevisionRecords(database: PostgresJsExecutor) {
  return database
    .select({
      id: subgraphs.id,
      graphId: subgraphs.graphId,
      slug: subgraphs.slug,
      revision: subgraphRevisions.revision,
      routingUrl: subgraphRevisions.routingUrl,
      createdAt: subgraphs.createdAt,
      updatedAt: subgraphs.updatedAt,
    })
    .from(subgraphs)
    .innerJoin(subgraphRevisions, subgraphRevisionJoinCondition());
}

function selectActiveSubgraphByGraphSlugAndSlugQuery(
  database: PostgresJsExecutor,
  graphSlug: string,
  slug: string,
) {
  return selectSubgraphWithRevisionRecords(database)
    .innerJoin(graphs, eq(graphs.id, subgraphs.graphId))
    .where(
      and(
        eq(graphs.slug, graphSlug),
        isNull(graphs.deletedAt),
        eq(subgraphs.slug, slug),
        isNull(subgraphs.deletedAt),
      ),
    )
    .limit(1);
}

function selectActiveSubgraphByGraphIdAndSlugQuery(
  database: PostgresJsExecutor,
  graphId: string,
  slug: string,
) {
  return selectSubgraphWithRevisionRecords(database)
    .where(
      and(eq(subgraphs.graphId, graphId), eq(subgraphs.slug, slug), isNull(subgraphs.deletedAt)),
    )
    .limit(1);
}

export async function selectActiveSubgraphByGraphSlugAndSlug(
  database: PostgresJsExecutor,
  graphSlug: string,
  slug: string,
): Promise<ActiveSubgraph | undefined> {
  const [subgraph] = await selectActiveSubgraphByGraphSlugAndSlugQuery(database, graphSlug, slug);
  return subgraph;
}

export async function selectActiveSubgraphsByGraphId(
  database: PostgresJsExecutor,
  graphId: string,
): Promise<ActiveSubgraph[]> {
  return selectSubgraphWithRevisionRecords(database)
    .where(and(eq(subgraphs.graphId, graphId), isNull(subgraphs.deletedAt)))
    .orderBy(asc(subgraphs.slug));
}

export async function selectActiveSubgraphByGraphIdAndSlugForUpdate(
  database: PostgresJsExecutor,
  graphId: string,
  slug: string,
): Promise<ActiveSubgraph | undefined> {
  const [subgraph] = await selectActiveSubgraphByGraphIdAndSlugQuery(database, graphId, slug).for(
    "update",
    {
      of: subgraphs,
    },
  );

  return subgraph;
}
