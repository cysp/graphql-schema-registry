import { graphs } from "../../../drizzle/schema.ts";

export const initialRevision = 1;

export const graphRowSelection = {
  id: graphs.id,
  slug: graphs.slug,
  currentCompositionRevision: graphs.currentCompositionRevision,
  createdAt: graphs.createdAt,
  updatedAt: graphs.updatedAt,
};

export const graphIdSelection = {
  id: graphs.id,
};
