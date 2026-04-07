import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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
    currentRevision: bigint({ mode: "bigint" }).notNull(),
    currentSupergraphSchemaRevision: bigint({
      mode: "bigint",
    }),
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
    revision: bigint({ mode: "bigint" }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.graphId, table.revision] }),
    check("graph_revisions_revision_positive", sql`${table.revision} > 0`),
  ],
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
    currentRevision: bigint({ mode: "bigint" }).notNull(),
    currentSchemaRevision: bigint({ mode: "bigint" }),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    unique().on(table.id, table.graphId),
    uniqueIndex()
      .on(table.graphId, table.slug)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const subgraphRevisions = pgTable(
  "subgraph_revisions",
  {
    subgraphId: uuid()
      .notNull()
      .references(() => subgraphs.id),
    revision: bigint({ mode: "bigint" }).notNull(),
    routingUrl: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.subgraphId, table.revision] }),
    check("subgraph_revisions_revision_positive", sql`${table.revision} > 0`),
  ],
);

export const subgraphSchemaRevisions = pgTable(
  "subgraph_schema_revisions",
  {
    subgraphId: uuid()
      .notNull()
      .references(() => subgraphs.id),
    revision: bigint({ mode: "bigint" }).notNull(),
    normalizedSdl: text().notNull(),
    normalizedHash: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.subgraphId, table.revision] }),
    index().on(table.subgraphId, table.normalizedHash),
    check("subgraph_schema_revisions_revision_positive", sql`${table.revision} > 0`),
    check(
      "subgraph_schema_revisions_normalized_hash_sha256_hex",
      sql`${table.normalizedHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const supergraphSchemaRevisions = pgTable(
  "supergraph_schema_revisions",
  {
    graphId: uuid()
      .notNull()
      .references(() => graphs.id),
    revision: bigint({ mode: "bigint" }).notNull(),
    supergraphSdl: text().notNull(),
    schemaHash: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.graphId, table.revision] }),
    check("supergraph_schema_revisions_revision_positive", sql`${table.revision} > 0`),
    check(
      "supergraph_schema_revisions_schema_hash_sha256_hex",
      sql`${table.schemaHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const supergraphSchemaRevisionSubgraphs = pgTable(
  "supergraph_schema_revision_subgraphs",
  {
    graphId: uuid().notNull(),
    supergraphSchemaRevision: bigint({ mode: "bigint" }).notNull(),
    subgraphId: uuid()
      .notNull()
      .references(() => subgraphs.id),
    subgraphRevision: bigint({ mode: "bigint" }).notNull(),
    subgraphSchemaRevision: bigint({ mode: "bigint" }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.graphId, table.supergraphSchemaRevision, table.subgraphId],
    }),
    index().on(table.subgraphId),
  ],
);
