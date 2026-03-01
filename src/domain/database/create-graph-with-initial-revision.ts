import { graphRevisions, graphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";

type CreateGraphWithInitialRevisionInput = Readonly<{
  federationVersion: string;
  now: Date;
  slug: string;
}>;

const INITIAL_GRAPH_REVISION_ID = 1;

// oxlint-disable-next-line typescript-eslint/explicit-module-boundary-types
export async function createGraphWithInitialRevisionInTransaction(
  database: PostgresJsDatabase,
  { federationVersion, now, slug }: CreateGraphWithInitialRevisionInput,
) {
  const [graphRecord] = await database
    .insert(graphs)
    .values({
      createdAt: now,
      currentRevisionId: INITIAL_GRAPH_REVISION_ID,
      slug,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({
      createdAt: graphs.createdAt,
      externalId: graphs.externalId,
      id: graphs.id,
      slug: graphs.slug,
      updatedAt: graphs.updatedAt,
    });

  if (!graphRecord) {
    return;
  }

  await database.insert(graphRevisions).values({
    createdAt: now,
    federationVersion,
    graphId: graphRecord.id,
    revisionId: INITIAL_GRAPH_REVISION_ID,
  });

  return {
    createdAt: graphRecord.createdAt,
    externalId: graphRecord.externalId,
    federationVersion,
    id: graphRecord.id,
    revisionId: INITIAL_GRAPH_REVISION_ID,
    slug: graphRecord.slug,
    updatedAt: graphRecord.updatedAt,
  };
}
