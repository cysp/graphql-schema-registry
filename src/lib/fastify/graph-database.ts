import type { PostgresJsDatabase } from "../../drizzle/types.ts";

type GraphDataClient = {
  query: {
    graphs: {
      findFirst: PostgresJsDatabase["query"]["graphs"]["findFirst"];
      findMany: PostgresJsDatabase["query"]["graphs"]["findMany"];
    };
  };
};

export type GraphWithCurrentRevision = {
  createdAt: Date;
  currentRevision: {
    federationVersion: string;
    revisionId: number;
  } | null;
  currentRevisionId: number;
  deletedAt: Date | null;
  externalId: string;
  id: number;
  slug: string;
  updatedAt: Date;
};

export async function listActiveGraphs(
  database: GraphDataClient,
): Promise<GraphWithCurrentRevision[]> {
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

export async function getActiveGraphBySlug(
  database: GraphDataClient,
  slug: string,
): Promise<GraphWithCurrentRevision | undefined> {
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
