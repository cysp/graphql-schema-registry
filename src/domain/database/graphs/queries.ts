import { and, asc, eq, isNull } from "drizzle-orm";

import { graphRevisions, graphs } from "../../../drizzle/schema.ts";
import type { PostgresJsExecutor } from "../../../drizzle/types.ts";
import type { ActiveGraph } from "../types.ts";

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
    .innerJoin(
      graphRevisions,
      and(eq(graphRevisions.graphId, graphs.id), eq(graphRevisions.revision, graphs.revision)),
    );
}

export async function selectActiveGraphs(database: PostgresJsExecutor): Promise<ActiveGraph[]> {
  return selectGraphWithRevisionQuery(database)
    .where(isNull(graphs.deletedAt))
    .orderBy(asc(graphs.slug));
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

export async function selectActiveGraphBySlugForShare(
  database: PostgresJsExecutor,
  slug: string,
): Promise<ActiveGraph | undefined> {
  const [graph] = await selectActiveGraphBySlugQuery(database, slug).for("share", {
    of: graphs,
  });

  return graph;
}

export async function selectActiveGraphBySlugForUpdate(
  database: PostgresJsExecutor,
  slug: string,
): Promise<ActiveGraph | undefined> {
  const [graph] = await selectActiveGraphBySlugQuery(database, slug).for("update", {
    of: graphs,
  });

  return graph;
}
