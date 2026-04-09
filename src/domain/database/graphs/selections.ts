import { graphs } from "../../../drizzle/schema.ts";

export const initialRevision = 1n;

export const graphRowSelection = {
  id: graphs.id,
  slug: graphs.slug,
  currentCompositionRevision: graphs.currentCompositionRevision,
  currentSupergraphSchemaRevision: graphs.currentSupergraphSchemaRevision,
  createdAt: graphs.createdAt,
  updatedAt: graphs.updatedAt,
};

export const graphIdSelection = {
  id: graphs.id,
};
