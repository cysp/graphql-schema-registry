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
    id: uuid()
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    slug: text().notNull(),
    currentRevision: bigint({ mode: "number" }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex()
      .on(table.slug)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const graphRevisions = pgTable(
  "graph_revisions",
  {
    graphId: uuid()
      .notNull()
      .references(() => graphs.id),
    revision: bigint({ mode: "number" }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.graphId, table.revision] }), index().on(table.graphId)],
);

export const subgraphs = pgTable(
  "subgraphs",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    graphId: uuid()
      .notNull()
      .references(() => graphs.id),
    slug: text().notNull(),
    currentRevision: bigint({ mode: "number" }).notNull(),
    currentSchemaRevision: bigint({ mode: "number" }),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex()
      .on(table.graphId, table.slug)
      .where(sql`${table.deletedAt} is null`),
    index().on(table.graphId),
  ],
);

export const subgraphRevisions = pgTable(
  "subgraph_revisions",
  {
    subgraphId: uuid()
      .notNull()
      .references(() => subgraphs.id),
    revision: bigint({ mode: "number" }).notNull(),
    routingUrl: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.subgraphId, table.revision] }),
    index().on(table.subgraphId),
  ],
);

export const subgraphSchemaRevisions = pgTable(
  "subgraph_schema_revisions",
  {
    subgraphId: uuid()
      .notNull()
      .references(() => subgraphs.id),
    revision: bigint({ mode: "number" }).notNull(),
    normalizedSdl: text().notNull(),
    normalizedHash: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.subgraphId, table.revision] }),
    index().on(table.subgraphId),
    index().on(table.subgraphId, table.normalizedHash),
  ],
);
