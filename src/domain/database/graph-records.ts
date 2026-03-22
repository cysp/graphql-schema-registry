import { and, asc, eq, isNull } from "drizzle-orm";

import { graphRevisions, graphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase, PostgresJsExecutor } from "../../drizzle/types.ts";

export type ActiveGraph = {
  id: string;
  slug: string;
  revision: number;
  federationVersion: string;
  createdAt: Date;
  updatedAt: Date;
};

function graphRevisionJoinCondition() {
  return and(eq(graphRevisions.graphId, graphs.id), eq(graphRevisions.revision, graphs.revision));
}

function selectGraphWithRevisionQuery(database: PostgresJsExecutor) {
  return database
    .select({
      id: graphs.id,
      slug: graphs.slug,
      revision: graphRevisions.revision,
      federationVersion: graphRevisions.federationVersion,
      createdAt: graphs.createdAt,
      updatedAt: graphs.updatedAt,
    })
    .from(graphs)
    .innerJoin(graphRevisions, graphRevisionJoinCondition());
}

function selectActiveGraphIdBySlugQuery(database: PostgresJsExecutor, slug: string) {
  return database
    .select({
      id: graphs.id,
    })
    .from(graphs)
    .where(and(eq(graphs.slug, slug), isNull(graphs.deletedAt)))
    .limit(1);
}

function selectActiveGraphBySlugQuery(database: PostgresJsExecutor, slug: string) {
  return selectGraphWithRevisionQuery(database)
    .where(and(eq(graphs.slug, slug), isNull(graphs.deletedAt)))
    .limit(1);
}

export async function selectActiveGraphBySlug(
  database: PostgresJsExecutor,
  slug: string,
): Promise<ActiveGraph | undefined> {
  const [graph] = await selectActiveGraphBySlugQuery(database, slug);
  return graph;
}

export async function lockActiveGraphBySlug(
  database: PostgresJsExecutor,
  slug: string,
): Promise<ActiveGraph | undefined> {
  const [graph] = await selectActiveGraphBySlugQuery(database, slug).for("update", {
    of: graphs,
  });

  return graph;
}

export async function lockActiveGraphIdBySlug(
  database: PostgresJsExecutor,
  slug: string,
): Promise<string | undefined> {
  const [graphId] = await selectActiveGraphIdBySlugQuery(database, slug).for("update", {
    of: graphs,
  });
  return graphId?.id;
}

export async function selectActiveGraphs(database: PostgresJsDatabase): Promise<ActiveGraph[]> {
  return selectGraphWithRevisionQuery(database)
    .where(isNull(graphs.deletedAt))
    .orderBy(asc(graphs.slug));
}
