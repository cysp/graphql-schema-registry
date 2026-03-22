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
    revision: bigint("revision", { mode: "number" }).notNull(),
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
    revision: bigint("revision", { mode: "number" }).notNull(),
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
