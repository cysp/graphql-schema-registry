import type { PickDeep } from "type-fest";

import type { PostgresJsDatabase } from "../../drizzle/types.ts";

export type GetActiveGraphBySlugDatabase = PickDeep<PostgresJsDatabase, "query.graphs.findFirst">;

// oxlint-disable-next-line typescript-eslint/explicit-module-boundary-types
export function getActiveGraphBySlug(
  database: GetActiveGraphBySlugDatabase,
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
