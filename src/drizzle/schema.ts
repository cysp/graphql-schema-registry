import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const graphs = pgTable(
  "graphs",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    slug: text("slug").notNull(),
    currentRevision: bigint("current_revision", { mode: "number" }).notNull(),
    currentGraphCompositionRevision: bigint("current_graph_composition_revision", {
      mode: "number",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("graphs_active_slug_uniq")
      .on(table.slug)
      .where(sql`${table.deletedAt} is null`),
    index("graphs_active_slug_idx")
      .on(table.slug)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const graphRevisions = pgTable(
  "graph_revisions",
  {
    graphId: uuid("graph_id")
      .notNull()
      .references(() => graphs.id),
    revision: bigint("revision", { mode: "number" }).notNull(),
    federationVersion: text("federation_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.graphId, table.revision], name: "graph_revisions_pkey" }),
    index("graph_revisions_graph_idx").on(table.graphId),
  ],
);

export const subgraphs = pgTable(
  "subgraphs",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    graphId: uuid("graph_id")
      .notNull()
      .references(() => graphs.id),
    slug: text("slug").notNull(),
    currentRevision: bigint("current_revision", { mode: "number" }).notNull(),
    currentSchemaRevision: bigint("current_schema_revision", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("subgraphs_graph_active_slug_uniq")
      .on(table.graphId, table.slug)
      .where(sql`${table.deletedAt} is null`),
    index("subgraphs_graph_active_slug_idx")
      .on(table.graphId, table.slug)
      .where(sql`${table.deletedAt} is null`),
    index("subgraphs_graph_idx").on(table.graphId),
  ],
);

export const subgraphRevisions = pgTable(
  "subgraph_revisions",
  {
    subgraphId: uuid("subgraph_id")
      .notNull()
      .references(() => subgraphs.id),
    revision: bigint("revision", { mode: "number" }).notNull(),
    routingUrl: text("routing_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.subgraphId, table.revision],
      name: "subgraph_revisions_pkey",
    }),
    index("subgraph_revisions_subgraph_idx").on(table.subgraphId),
  ],
);

export const subgraphSchemaRevisions = pgTable(
  "subgraph_schema_revisions",
  {
    subgraphId: uuid("subgraph_id")
      .notNull()
      .references(() => subgraphs.id),
    revision: bigint("revision", { mode: "number" }).notNull(),
    normalizedSdl: text("normalized_sdl").notNull(),
    normalizedHash: text("normalized_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.subgraphId, table.revision],
      name: "subgraph_schema_revisions_pkey",
    }),
    index("subgraph_schema_revisions_subgraph_idx").on(table.subgraphId),
    index("subgraph_schema_revisions_subgraph_hash_idx").on(table.subgraphId, table.normalizedHash),
  ],
);
export const graphCompositions = pgTable(
  "graph_compositions",
  {
    graphId: uuid("graph_id")
      .notNull()
      .references(() => graphs.id),
    revision: bigint("revision", { mode: "number" }).notNull(),
    supergraphSdl: text("supergraph_sdl").notNull(),
    compositionHash: text("composition_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.graphId, table.revision],
      name: "graph_compositions_pkey",
    }),
    index("graph_compositions_graph_idx").on(table.graphId),
  ],
);

export const graphCompositionGraphRevisions = pgTable(
  "graph_composition_graph_revisions",
  {
    graphId: uuid("graph_id").notNull(),
    supergraphRevision: bigint("supergraph_revision", { mode: "number" }).notNull(),
    graphRevision: bigint("graph_revision", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.graphId, table.supergraphRevision],
      name: "graph_composition_graph_revisions_pkey",
    }),
  ],
);

export const graphCompositionSubgraphRevisions = pgTable(
  "graph_composition_subgraph_revisions",
  {
    graphId: uuid("graph_id").notNull(),
    supergraphRevision: bigint("supergraph_revision", { mode: "number" }).notNull(),
    subgraphId: uuid("subgraph_id").notNull(),
    subgraphRevision: bigint("subgraph_revision", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.graphId, table.supergraphRevision, table.subgraphId],
      name: "graph_composition_subgraph_revisions_pkey",
    }),
    index("graph_composition_subgraph_revisions_subgraph_idx").on(table.subgraphId),
  ],
);

export const graphCompositionSubgraphSchemaRevisions = pgTable(
  "graph_composition_subgraph_schema_revisions",
  {
    graphId: uuid("graph_id").notNull(),
    supergraphRevision: bigint("supergraph_revision", { mode: "number" }).notNull(),
    subgraphId: uuid("subgraph_id").notNull(),
    subgraphSchemaRevision: bigint("subgraph_schema_revision", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.graphId, table.supergraphRevision, table.subgraphId],
      name: "graph_composition_subgraph_schema_revisions_pkey",
    }),
    index("graph_composition_subgraph_schema_revisions_subgraph_idx").on(table.subgraphId),
  ],
);
