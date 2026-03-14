// oxlint-disable typescript-eslint/no-deprecated,eslint/no-use-before-define

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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

export const graphRevisions = pgTable(
  "graph_revisions",
  {
    graphId: bigint("graph_id", { mode: "number" })
      .notNull()
      .references((): AnyPgColumn => graphs.id, { name: "graph_revisions_graph_fk" }),
    revisionId: bigint("revision_id", { mode: "number" }).notNull(),
    federationVersion: text("federation_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.graphId, table.revisionId] }),
  }),
);

export const graphs = pgTable(
  "graphs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    externalId: uuid("external_id").notNull().defaultRandom(),
    slug: text("slug").notNull(),
    currentRevisionId: bigint("current_revision_id", { mode: "number" }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    currentRevisionFk: foreignKey({
      columns: [table.id, table.currentRevisionId],
      foreignColumns: [graphRevisions.graphId, graphRevisions.revisionId],
      name: "graphs_current_revision_fk",
    }),
    externalIdUnique: uniqueIndex("graphs_external_id_uniq").on(table.externalId),
    activeSlugUnique: uniqueIndex("graphs_active_slug_uniq")
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
    activeSlugIdx: index("graphs_active_slug_idx")
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
  }),
);

export const subgraphRevisions = pgTable(
  "subgraph_revisions",
  {
    subgraphId: bigint("subgraph_id", { mode: "number" })
      .notNull()
      .references((): AnyPgColumn => subgraphs.id, { name: "subgraph_revisions_subgraph_fk" }),
    revisionId: bigint("revision_id", { mode: "number" }).notNull(),
    routingUrl: text("routing_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.subgraphId, table.revisionId] }),
  }),
);

export const subgraphs = pgTable(
  "subgraphs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    externalId: uuid("external_id").notNull().defaultRandom(),
    graphId: bigint("graph_id", { mode: "number" })
      .notNull()
      .references(() => graphs.id, { name: "subgraphs_graph_fk" }),
    slug: text("slug").notNull(),
    currentRevisionId: bigint("current_revision_id", { mode: "number" }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    currentRevisionFk: foreignKey({
      columns: [table.id, table.currentRevisionId],
      foreignColumns: [subgraphRevisions.subgraphId, subgraphRevisions.revisionId],
      name: "subgraphs_current_revision_fk",
    }),
    externalIdUnique: uniqueIndex("subgraphs_external_id_uniq").on(table.externalId),
    graphSlugActiveUnique: uniqueIndex("subgraphs_graph_active_slug_uniq")
      .on(table.graphId, table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
    graphSlugActiveIdx: index("subgraphs_graph_active_slug_idx")
      .on(table.graphId, table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
  }),
);
