import { graphRevisions, graphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";

type CreateGraphWithInitialRevisionInput = Readonly<{
  slug: string;
  federationVersion: string;
  now: Date;
}>;

const INITIAL_GRAPH_REVISION_ID = 1;

// oxlint-disable-next-line typescript-eslint/explicit-module-boundary-types
export async function createGraphWithInitialRevisionInTransaction(
  database: PostgresJsDatabase,
  { federationVersion, now, slug }: CreateGraphWithInitialRevisionInput,
) {
  const [graph] = await database
    .insert(graphs)
    .values({
      slug,
      currentRevisionId: INITIAL_GRAPH_REVISION_ID,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({
      id: graphs.id,
      externalId: graphs.externalId,
      slug: graphs.slug,
      createdAt: graphs.createdAt,
      updatedAt: graphs.updatedAt,
    });

  if (!graph) {
    return;
  }

  await database.insert(graphRevisions).values({
    graphId: graph.id,
    revisionId: INITIAL_GRAPH_REVISION_ID,
    federationVersion,
    createdAt: now,
  });

  return {
    id: graph.id,
    externalId: graph.externalId,
    slug: graph.slug,
    revisionId: INITIAL_GRAPH_REVISION_ID,
    federationVersion,
    createdAt: graph.createdAt,
    updatedAt: graph.updatedAt,
  };
}
