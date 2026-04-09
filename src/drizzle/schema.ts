// oxlint-disable no-use-before-define
import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bytea,
  foreignKey,
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
    currentRevision: bigint({ mode: "bigint" }).notNull(),
    currentCompositionRevision: bigint({ mode: "bigint" }),
    currentSupergraphSchemaRevision: bigint({ mode: "bigint" }),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex()
      .on(table.slug)
      .where(sql`${table.deletedAt} is null`),
    foreignKey({
      columns: [table.id, table.currentCompositionRevision],
      foreignColumns: [graphCompositions.graphId, graphCompositions.revision],
    }),
    foreignKey({
      columns: [table.id, table.currentSupergraphSchemaRevision],
      foreignColumns: [supergraphSchemas.graphId, supergraphSchemas.compositionRevision],
    }),
  ],
);

export const graphRevisions = pgTable(
  "graph_revisions",
  {
    graphId: uuid()
      .notNull()
      .references((): AnyPgColumn => graphs.id),
    revision: bigint({ mode: "bigint" }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.graphId, table.revision] })],
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
    uniqueIndex()
      .on(table.graphId, table.slug)
      .where(sql`${table.deletedAt} is null`),
    foreignKey({
      columns: [table.id, table.currentSchemaRevision],
      foreignColumns: [subgraphSchemaRevisions.subgraphId, subgraphSchemaRevisions.revision],
    }),
  ],
);

export const subgraphRevisions = pgTable(
  "subgraph_revisions",
  {
    subgraphId: uuid()
      .notNull()
      .references((): AnyPgColumn => subgraphs.id),
    revision: bigint({ mode: "bigint" }).notNull(),
    routingUrl: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.subgraphId, table.revision] })],
);

export const subgraphSchemaRevisions = pgTable(
  "subgraph_schema_revisions",
  {
    subgraphId: uuid()
      .notNull()
      .references((): AnyPgColumn => subgraphs.id),
    revision: bigint({ mode: "bigint" }).notNull(),
    normalizedSdl: text().notNull(),
    normalizedSdlSha256: bytea()
      .generatedAlwaysAs((): ReturnType<typeof sql> => sql`digest("normalized_sdl", 'sha256')`)
      .notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.subgraphId, table.revision] })],
);

export const graphCompositions = pgTable(
  "graph_compositions",
  {
    graphId: uuid()
      .notNull()
      .references((): AnyPgColumn => graphs.id),
    revision: bigint({ mode: "bigint" }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.graphId, table.revision] })],
);

export const supergraphSchemas = pgTable(
  "supergraph_schemas",
  {
    graphId: uuid()
      .notNull()
      .references((): AnyPgColumn => graphs.id),
    compositionRevision: bigint({ mode: "bigint" }).notNull(),
    supergraphSdl: text().notNull(),
    supergraphSdlSha256: bytea()
      .generatedAlwaysAs((): ReturnType<typeof sql> => sql`digest("supergraph_sdl", 'sha256')`)
      .notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.graphId, table.compositionRevision] }),
    foreignKey({
      columns: [table.graphId, table.compositionRevision],
      foreignColumns: [graphCompositions.graphId, graphCompositions.revision],
    }),
  ],
);

export const graphCompositionSubgraphs = pgTable(
  "graph_composition_subgraphs",
  {
    graphId: uuid()
      .notNull()
      .references(() => graphs.id),
    compositionRevision: bigint({ mode: "bigint" }).notNull(),
    subgraphId: uuid()
      .notNull()
      .references(() => subgraphs.id),
    subgraphRevision: bigint({ mode: "bigint" }).notNull(),
    subgraphSchemaRevision: bigint({ mode: "bigint" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.graphId, table.compositionRevision, table.subgraphId] }),
    foreignKey({
      columns: [table.graphId, table.compositionRevision],
      foreignColumns: [graphCompositions.graphId, graphCompositions.revision],
    }),
    foreignKey({
      columns: [table.subgraphId, table.subgraphRevision],
      foreignColumns: [subgraphRevisions.subgraphId, subgraphRevisions.revision],
    }),
    foreignKey({
      columns: [table.subgraphId, table.subgraphSchemaRevision],
      foreignColumns: [subgraphSchemaRevisions.subgraphId, subgraphSchemaRevisions.revision],
    }),
  ],
);
