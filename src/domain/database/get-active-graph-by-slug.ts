import type { PostgresJsDatabase } from "../../drizzle/types.ts";

// oxlint-disable-next-line typescript-eslint/explicit-module-boundary-types
export function getActiveGraphBySlug(
  database: PostgresJsDatabase,
  slug: string,
) {
  return database.query.graphs.findFirst({
    where: {
      deletedAt: {
        isNull: true,
      },
      slug,
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
