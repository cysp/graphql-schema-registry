import { subgraphs } from "../../../drizzle/schema.ts";

export const initialRevision = 1n;

export const subgraphRowSelection = {
  graphId: subgraphs.graphId,
  id: subgraphs.id,
  slug: subgraphs.slug,
  createdAt: subgraphs.createdAt,
  updatedAt: subgraphs.updatedAt,
};

export const subgraphIdSelection = {
  id: subgraphs.id,
};
