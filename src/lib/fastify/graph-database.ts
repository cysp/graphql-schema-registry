import type { PostgresJsDatabase } from "../../drizzle/types.ts";

type GraphQueryClient = {
  query: {
    graphs: {
      findFirst: PostgresJsDatabase["query"]["graphs"]["findFirst"];
      findMany: PostgresJsDatabase["query"]["graphs"]["findMany"];
    };
  };
};

export type GraphWithLatestRevision = {
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

export async function listGraphs(database: GraphQueryClient): Promise<GraphWithLatestRevision[]> {
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

export async function getGraphBySlug(
  database: GraphQueryClient,
  slug: string,
): Promise<GraphWithLatestRevision | undefined> {
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
