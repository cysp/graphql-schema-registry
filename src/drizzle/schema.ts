// oxlint-disable typescript-eslint/no-deprecated

import { sql } from "drizzle-orm";
import {
  bigserial,
  bigint,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { defineRelations } from "drizzle-orm/relations";

export const graphs = pgTable(
  "graphs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    externalId: uuid("external_id").notNull().defaultRandom(),
    slug: text("slug").notNull(),
    federationVersion: text("federation_version").notNull(),
    revisionId: bigint("revision_id", { mode: "number" }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    externalIdUnique: uniqueIndex("graphs_external_id_uniq").on(table.externalId),
    activeSlugUnique: uniqueIndex("graphs_active_slug_uniq")
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
    activeSlugIdx: index("graphs_active_slug_idx")
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
  }),
);

export const graphRevisions = pgTable(
  "graph_revisions",
  {
    graphId: bigint("graph_id", { mode: "number" }).notNull(),
    revisionId: bigint("revision_id", { mode: "number" }).notNull(),
    federationVersion: text("federation_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.graphId, table.revisionId] }),
    graphFk: foreignKey({
      columns: [table.graphId],
      foreignColumns: [graphs.id],
      name: "graph_revisions_graph_fk",
    }),
  }),
);

export const subgraphs = pgTable(
  "subgraphs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    externalId: uuid("external_id").notNull().defaultRandom(),
    graphId: bigint("graph_id", { mode: "number" }).notNull(),
    slug: text("slug").notNull(),
    routingUrl: text("routing_url").notNull(),
    revisionId: bigint("revision_id", { mode: "number" }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    externalIdUnique: uniqueIndex("subgraphs_external_id_uniq").on(table.externalId),
    graphSlugActiveUnique: uniqueIndex("subgraphs_graph_active_slug_uniq")
      .on(table.graphId, table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
    graphSlugActiveIdx: index("subgraphs_graph_active_slug_idx")
      .on(table.graphId, table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
    graphFk: foreignKey({
      columns: [table.graphId],
      foreignColumns: [graphs.id],
      name: "subgraphs_graph_fk",
    }),
  }),
);

export const subgraphRevisions = pgTable(
  "subgraph_revisions",
  {
    subgraphId: bigint("subgraph_id", { mode: "number" }).notNull(),
    revisionId: bigint("revision_id", { mode: "number" }).notNull(),
    routingUrl: text("routing_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.subgraphId, table.revisionId] }),
    subgraphFk: foreignKey({
      columns: [table.subgraphId],
      foreignColumns: [subgraphs.id],
      name: "subgraph_revisions_subgraph_fk",
    }),
  }),
);

export const relations = defineRelations(
  { graphs, graphRevisions, subgraphs, subgraphRevisions },
  ({
    graphs: graphColumns,
    graphRevisions: graphRevisionColumns,
    subgraphs: subgraphColumns,
    subgraphRevisions: subgraphRevisionColumns,
    many,
    one,
  }) => ({
    graphs: {
      revisions: many.graphRevisions({
        from: graphColumns.id,
        to: graphRevisionColumns.graphId,
      }),
      subgraphs: many.subgraphs({
        from: graphColumns.id,
        to: subgraphColumns.graphId,
      }),
    },
    graphRevisions: {
      graph: one.graphs({
        from: graphRevisionColumns.graphId,
        to: graphColumns.id,
        optional: false,
      }),
    },
    subgraphs: {
      graph: one.graphs({
        from: subgraphColumns.graphId,
        to: graphColumns.id,
        optional: false,
      }),
      revisions: many.subgraphRevisions({
        from: subgraphColumns.id,
        to: subgraphRevisionColumns.subgraphId,
      }),
    },
    subgraphRevisions: {
      subgraph: one.subgraphs({
        from: subgraphRevisionColumns.subgraphId,
        to: subgraphColumns.id,
        optional: false,
      }),
    },
  }),
);

export const graphsRelations = relations.graphs.relations;
export const graphRevisionsRelations = relations.graphRevisions.relations;
export const subgraphsRelations = relations.subgraphs.relations;
export const subgraphRevisionsRelations = relations.subgraphRevisions.relations;

export type GraphRow = typeof graphs.$inferSelect;
export type SubgraphRow = typeof subgraphs.$inferSelect;
