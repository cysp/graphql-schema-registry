import type { PickDeep } from "type-fest";

import type { PostgresJsDatabase } from "../../drizzle/types.ts";

export type ListActiveGraphsDatabase = PickDeep<PostgresJsDatabase, "query.graphs.findMany">;

// oxlint-disable-next-line typescript-eslint/explicit-module-boundary-types
export function listActiveGraphs(database: ListActiveGraphsDatabase) {
  return database.query.graphs.findMany({
    where: {
      deletedAt: {
        isNull: true,
      },
    },
    orderBy: {
      slug: "asc",
    },
    with: {
      currentRevision: {
        columns: {
          federationVersion: true,
          revisionId: true,
        },
      },
    },
  });
}
