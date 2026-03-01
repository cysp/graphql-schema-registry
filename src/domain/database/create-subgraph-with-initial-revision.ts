import { subgraphRevisions, subgraphs } from "../../drizzle/schema.ts";
import type { PostgresJsDatabase } from "../../drizzle/types.ts";

type CreateSubgraphWithInitialRevisionInput = Readonly<{
  graphId: number;
  slug: string;
  routingUrl: string;
  now: Date;
}>;

const INITIAL_SUBGRAPH_REVISION_ID = 1;

// oxlint-disable-next-line typescript-eslint/explicit-module-boundary-types
export async function createSubgraphWithInitialRevisionInTransaction(
  database: PostgresJsDatabase,
  { graphId, slug, routingUrl, now }: CreateSubgraphWithInitialRevisionInput,
) {
  const [subgraph] = await database
    .insert(subgraphs)
    .values({
      graphId,
      slug,
      currentRevisionId: INITIAL_SUBGRAPH_REVISION_ID,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({
      id: subgraphs.id,
      externalId: subgraphs.externalId,
      graphId: subgraphs.graphId,
      slug: subgraphs.slug,
      createdAt: subgraphs.createdAt,
      updatedAt: subgraphs.updatedAt,
    });

  if (!subgraph) {
    return;
  }

  await database.insert(subgraphRevisions).values({
    subgraphId: subgraph.id,
    revisionId: INITIAL_SUBGRAPH_REVISION_ID,
    routingUrl,
    createdAt: now,
  });

  return {
    id: subgraph.id,
    externalId: subgraph.externalId,
    graphId: subgraph.graphId,
    slug: subgraph.slug,
    revisionId: INITIAL_SUBGRAPH_REVISION_ID,
    routingUrl,
    createdAt: subgraph.createdAt,
    updatedAt: subgraph.updatedAt,
  };
}
