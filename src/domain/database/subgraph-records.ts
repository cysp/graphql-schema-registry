import { and, asc, eq, isNull } from "drizzle-orm";

import { graphs, subgraphRevisions, subgraphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase, PostgresJsExecutor } from "../../drizzle/types.ts";

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

function selectActiveSubgraphByGraphIdAndSlugQuery(
  database: PostgresJsExecutor,
  graphId: string,
  subgraphSlug: string,
) {
  return selectSubgraphWithRevisionRecords(database)
    .where(
      and(
        eq(subgraphs.graphId, graphId),
        eq(subgraphs.slug, subgraphSlug),
        isNull(subgraphs.deletedAt),
      ),
    )
    .limit(1);
}

function selectActiveSubgraphByGraphSlugAndSlugQuery(
  database: PostgresJsExecutor,
  graphSlug: string,
  subgraphSlug: string,
) {
  return selectSubgraphWithRevisionRecords(database)
    .innerJoin(graphs, eq(graphs.id, subgraphs.graphId))
    .where(
      and(
        eq(graphs.slug, graphSlug),
        isNull(graphs.deletedAt),
        eq(subgraphs.slug, subgraphSlug),
        isNull(subgraphs.deletedAt),
      ),
    )
    .limit(1);
}

export async function lockActiveSubgraphByGraphIdAndSlug(
  database: PostgresJsExecutor,
  graphId: string,
  subgraphSlug: string,
): Promise<ActiveSubgraph | undefined> {
  const [subgraph] = await selectActiveSubgraphByGraphIdAndSlugQuery(
    database,
    graphId,
    subgraphSlug,
  ).for("update", { of: subgraphs });

  return subgraph;
}

export async function selectActiveSubgraphByGraphSlugAndSubgraphSlug(
  database: PostgresJsDatabase,
  graphSlug: string,
  subgraphSlug: string,
): Promise<ActiveSubgraph | undefined> {
  const [subgraph] = await selectActiveSubgraphByGraphSlugAndSlugQuery(
    database,
    graphSlug,
    subgraphSlug,
  );

  return subgraph;
}

export async function selectActiveSubgraphsByGraphSlug(
  database: PostgresJsDatabase,
  graphSlug: string,
): Promise<ActiveSubgraph[] | undefined> {
  const graphScopedActiveSubgraphs = await database
    .select({
      graphId: graphs.id,
      id: subgraphs.id,
      slug: subgraphs.slug,
      revision: subgraphRevisions.revision,
      routingUrl: subgraphRevisions.routingUrl,
      createdAt: subgraphs.createdAt,
      updatedAt: subgraphs.updatedAt,
    })
    .from(graphs)
    .leftJoin(subgraphs, and(eq(subgraphs.graphId, graphs.id), isNull(subgraphs.deletedAt)))
    .leftJoin(subgraphRevisions, subgraphRevisionJoinCondition())
    .where(and(eq(graphs.slug, graphSlug), isNull(graphs.deletedAt)))
    .orderBy(asc(subgraphs.slug));

  if (graphScopedActiveSubgraphs.length === 0) {
    return undefined;
  }

  return graphScopedActiveSubgraphs.flatMap((subgraph) => {
    if (subgraph.id === null) {
      return [];
    }

    if (
      subgraph.createdAt === null ||
      subgraph.revision === null ||
      subgraph.routingUrl === null ||
      subgraph.slug === null ||
      subgraph.updatedAt === null
    ) {
      throw new Error("Subgraph row is missing revision data.");
    }

    return [
      {
        createdAt: subgraph.createdAt,
        graphId: subgraph.graphId,
        id: subgraph.id,
        revision: subgraph.revision,
        routingUrl: subgraph.routingUrl,
        slug: subgraph.slug,
        updatedAt: subgraph.updatedAt,
      },
    ];
  });
}
