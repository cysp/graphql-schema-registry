import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { subgraphSchemaRevisions, subgraphs } from "../../../drizzle/schema.ts";
import type { PostgresJsExecutor, PostgresJsTransaction } from "../../../drizzle/types.ts";
import type { StoredSubgraphSchemaRevision } from "../types.ts";

export async function selectCurrentSubgraphSchemaRevision(
  database: PostgresJsExecutor,
  subgraphId: string,
): Promise<StoredSubgraphSchemaRevision | undefined> {
  const [revision] = await database
    .select({
      subgraphId: subgraphSchemaRevisions.subgraphId,
      revision: subgraphSchemaRevisions.revision,
      normalizedHash: subgraphSchemaRevisions.normalizedHash,
      normalizedSdl: subgraphSchemaRevisions.normalizedSdl,
      createdAt: subgraphSchemaRevisions.createdAt,
    })
    .from(subgraphs)
    .innerJoin(
      subgraphSchemaRevisions,
      and(
        eq(subgraphSchemaRevisions.subgraphId, subgraphs.id),
        eq(subgraphSchemaRevisions.revision, subgraphs.currentSchemaRevision),
      ),
    )
    .where(and(eq(subgraphs.id, subgraphId), isNull(subgraphs.deletedAt)))
    .limit(1);

  return revision;
}

export async function selectLatestSubgraphSchemaRevision(
  database: PostgresJsExecutor,
  subgraphId: string,
): Promise<StoredSubgraphSchemaRevision | undefined> {
  const [revision] = await database
    .select({
      subgraphId: subgraphSchemaRevisions.subgraphId,
      revision: subgraphSchemaRevisions.revision,
      normalizedHash: subgraphSchemaRevisions.normalizedHash,
      normalizedSdl: subgraphSchemaRevisions.normalizedSdl,
      createdAt: subgraphSchemaRevisions.createdAt,
    })
    .from(subgraphSchemaRevisions)
    .where(eq(subgraphSchemaRevisions.subgraphId, subgraphId))
    .orderBy(desc(subgraphSchemaRevisions.revision))
    .limit(1);

  return revision;
}

export async function selectLatestSubgraphSchemaRevisions(
  database: PostgresJsExecutor,
  subgraphIds: string[],
): Promise<Map<string, StoredSubgraphSchemaRevision>> {
  if (subgraphIds.length === 0) {
    return new Map();
  }

  const latestRevisionSubquery = database
    .select({
      subgraphId: subgraphSchemaRevisions.subgraphId,
      revision: sql<number>`max(${subgraphSchemaRevisions.revision})`.as("revision"),
    })
    .from(subgraphSchemaRevisions)
    .where(inArray(subgraphSchemaRevisions.subgraphId, subgraphIds))
    .groupBy(subgraphSchemaRevisions.subgraphId)
    .as("latest_subgraph_schema_revisions");

  const rows = await database
    .select({
      subgraphId: subgraphSchemaRevisions.subgraphId,
      revision: subgraphSchemaRevisions.revision,
      normalizedHash: subgraphSchemaRevisions.normalizedHash,
      normalizedSdl: subgraphSchemaRevisions.normalizedSdl,
      createdAt: subgraphSchemaRevisions.createdAt,
    })
    .from(subgraphSchemaRevisions)
    .innerJoin(
      latestRevisionSubquery,
      and(
        eq(subgraphSchemaRevisions.subgraphId, latestRevisionSubquery.subgraphId),
        eq(subgraphSchemaRevisions.revision, latestRevisionSubquery.revision),
      ),
    );

  return new Map(rows.map((row) => [row.subgraphId, row] as const));
}

export async function selectSubgraphSchemaRevision(
  database: PostgresJsExecutor,
  subgraphId: string,
  revision: number,
): Promise<StoredSubgraphSchemaRevision | undefined> {
  const [schemaRevision] = await database
    .select({
      subgraphId: subgraphSchemaRevisions.subgraphId,
      revision: subgraphSchemaRevisions.revision,
      normalizedHash: subgraphSchemaRevisions.normalizedHash,
      normalizedSdl: subgraphSchemaRevisions.normalizedSdl,
      createdAt: subgraphSchemaRevisions.createdAt,
    })
    .from(subgraphSchemaRevisions)
    .where(
      and(
        eq(subgraphSchemaRevisions.subgraphId, subgraphId),
        eq(subgraphSchemaRevisions.revision, revision),
      ),
    )
    .limit(1);

  return schemaRevision;
}

export async function selectSubgraphSchemaRevisions(
  database: PostgresJsExecutor,
  revisions: Array<{
    revision: number;
    subgraphId: string;
  }>,
): Promise<Map<string, StoredSubgraphSchemaRevision>> {
  if (revisions.length === 0) {
    return new Map();
  }

  const rows = await database
    .select({
      subgraphId: subgraphSchemaRevisions.subgraphId,
      revision: subgraphSchemaRevisions.revision,
      normalizedHash: subgraphSchemaRevisions.normalizedHash,
      normalizedSdl: subgraphSchemaRevisions.normalizedSdl,
      createdAt: subgraphSchemaRevisions.createdAt,
    })
    .from(subgraphSchemaRevisions)
    .where(
      or(
        ...revisions.map(({ subgraphId, revision }) =>
          and(
            eq(subgraphSchemaRevisions.subgraphId, subgraphId),
            eq(subgraphSchemaRevisions.revision, revision),
          ),
        ),
      ),
    );

  return new Map(rows.map((row) => [row.subgraphId, row] as const));
}

export async function insertSubgraphSchemaRevision(
  transaction: PostgresJsTransaction,
  input: {
    createdAt: Date;
    normalizedHash: string;
    normalizedSdl: string;
    revision: number;
    subgraphId: string;
  },
): Promise<void> {
  await transaction.insert(subgraphSchemaRevisions).values(input);
}

export async function insertSubgraphSchemaRevisionAndSetCurrent(
  transaction: PostgresJsTransaction,
  input: {
    createdAt: Date;
    normalizedHash: string;
    normalizedSdl: string;
    revision: number;
    subgraphId: string;
  },
): Promise<StoredSubgraphSchemaRevision> {
  await insertSubgraphSchemaRevision(transaction, input);

  const [updatedSubgraph] = await transaction
    .update(subgraphs)
    .set({
      currentSchemaRevision: input.revision,
    })
    .where(and(eq(subgraphs.id, input.subgraphId), isNull(subgraphs.deletedAt)))
    .returning({ id: subgraphs.id });

  if (!updatedSubgraph) {
    throw new Error("Subgraph schema pointer update did not return the locked row.");
  }

  return input;
}
