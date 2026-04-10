import { and, eq, isNull } from "drizzle-orm";

import { graphs, supergraphSchemas } from "../../../drizzle/schema.ts";
import type { PostgresJsExecutor } from "../../../drizzle/types.ts";
import type { StoredSupergraphSchema } from "../types.ts";

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
