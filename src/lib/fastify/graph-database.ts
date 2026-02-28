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
  deletedAt: Date | null;
  externalId: string;
  federationVersion: string;
  id: number;
  revisionId: number;
  revisions: Array<{
    federationVersion: string;
    revisionId: number;
  }>;
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
      revisions: {
        columns: {
          federationVersion: true,
          revisionId: true,
        },
        limit: 1,
        orderBy: {
          revisionId: "desc",
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
      revisions: {
        columns: {
          federationVersion: true,
          revisionId: true,
        },
        limit: 1,
        orderBy: {
          revisionId: "desc",
        },
      },
    },
  });
}
