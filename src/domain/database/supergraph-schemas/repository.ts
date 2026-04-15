import { and, eq, isNull } from "drizzle-orm";

import { graphs, supergraphSchemas } from "../../../drizzle/schema.ts";
import type { PostgresJsExecutor } from "../../../drizzle/types.ts";
import type { StoredSupergraphSchema } from "../types.ts";

export type CurrentSupergraphSchemaVersion = Pick<
  StoredSupergraphSchema,
  "graphId" | "compositionRevision"
>;

export async function selectCurrentSupergraphSchemaVersion(
  database: PostgresJsExecutor,
  graphId: string,
): Promise<CurrentSupergraphSchemaVersion | undefined> {
  const [graph] = await database
    .select({
      graphId: graphs.id,
      compositionRevision: graphs.currentSupergraphSchemaRevision,
    })
    .from(graphs)
    .where(and(eq(graphs.id, graphId), isNull(graphs.deletedAt)))
    .limit(1);

  if (!graph || graph.compositionRevision === null) {
    return undefined;
  }

  return {
    graphId: graph.graphId,
    compositionRevision: graph.compositionRevision,
  };
}

export async function selectSupergraphSchemaRevision(
  database: PostgresJsExecutor,
  graphId: string,
  compositionRevision: bigint,
): Promise<StoredSupergraphSchema | undefined> {
  const [revision] = await database
    .select({
      graphId: supergraphSchemas.graphId,
      compositionRevision: supergraphSchemas.compositionRevision,
      supergraphSdlSha256: supergraphSchemas.supergraphSdlSha256,
      supergraphSdl: supergraphSchemas.supergraphSdl,
      createdAt: supergraphSchemas.createdAt,
    })
    .from(supergraphSchemas)
    .innerJoin(graphs, eq(supergraphSchemas.graphId, graphs.id))
    .where(
      and(
        eq(supergraphSchemas.graphId, graphId),
        eq(supergraphSchemas.compositionRevision, compositionRevision),
        isNull(graphs.deletedAt),
      ),
    )
    .limit(1);

  return revision;
}

export async function selectCurrentSupergraphSchemaRevision(
  database: PostgresJsExecutor,
  graphId: string,
): Promise<StoredSupergraphSchema | undefined> {
  const [revision] = await database
    .select({
      graphId: supergraphSchemas.graphId,
      compositionRevision: supergraphSchemas.compositionRevision,
      supergraphSdlSha256: supergraphSchemas.supergraphSdlSha256,
      supergraphSdl: supergraphSchemas.supergraphSdl,
      createdAt: supergraphSchemas.createdAt,
    })
    .from(graphs)
    .innerJoin(
      supergraphSchemas,
      and(
        eq(supergraphSchemas.graphId, graphs.id),
        eq(supergraphSchemas.compositionRevision, graphs.currentSupergraphSchemaRevision),
      ),
    )
    .where(and(eq(graphs.id, graphId), isNull(graphs.deletedAt)))
    .limit(1);

  return revision;
}
