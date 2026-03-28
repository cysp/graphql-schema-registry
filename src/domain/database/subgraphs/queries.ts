import { and, asc, eq, isNull } from "drizzle-orm";

import { graphs, subgraphRevisions, subgraphs } from "../../../drizzle/schema.ts";
import type { PostgresJsExecutor } from "../../../drizzle/types.ts";
import type { ActiveSubgraph } from "../types.ts";

function selectSubgraphWithRevisionQuery(database: PostgresJsExecutor) {
  return database
    .select({
      graphId: subgraphs.graphId,
      id: subgraphs.id,
      slug: subgraphs.slug,
      revision: subgraphRevisions.revision,
      routingUrl: subgraphRevisions.routingUrl,
      createdAt: subgraphs.createdAt,
      updatedAt: subgraphs.updatedAt,
    })
    .from(subgraphs)
    .innerJoin(
      subgraphRevisions,
      and(
        eq(subgraphRevisions.subgraphId, subgraphs.id),
        eq(subgraphRevisions.revision, subgraphs.revision),
      ),
    );
}

function selectActiveSubgraphByGraphIdAndSlugQuery(
  database: PostgresJsExecutor,
  graphId: string,
  slug: string,
) {
  return selectSubgraphWithRevisionQuery(database)
    .where(
      and(eq(subgraphs.graphId, graphId), eq(subgraphs.slug, slug), isNull(subgraphs.deletedAt)),
    )
    .limit(1);
}

function selectActiveSubgraphByGraphSlugAndSlugQuery(
  database: PostgresJsExecutor,
  graphSlug: string,
  slug: string,
) {
  return selectSubgraphWithRevisionQuery(database)
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

export async function selectActiveSubgraphsByGraphId(
  database: PostgresJsExecutor,
  graphId: string,
): Promise<ActiveSubgraph[]> {
  return selectSubgraphWithRevisionQuery(database)
    .where(and(eq(subgraphs.graphId, graphId), isNull(subgraphs.deletedAt)))
    .orderBy(asc(subgraphs.slug));
}

export async function selectActiveSubgraphByGraphSlugAndSlug(
  database: PostgresJsExecutor,
  graphSlug: string,
  slug: string,
): Promise<ActiveSubgraph | undefined> {
  const [subgraph] = await selectActiveSubgraphByGraphSlugAndSlugQuery(database, graphSlug, slug);
  return subgraph;
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
