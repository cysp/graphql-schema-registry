import type { PostgresJsDatabase } from "../../drizzle/types.ts";

// oxlint-disable-next-line typescript-eslint/explicit-module-boundary-types
export function listActiveGraphs(database: PostgresJsDatabase) {
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
