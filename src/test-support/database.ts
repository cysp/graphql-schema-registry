import { readFile } from "node:fs/promises";

import postgres from "postgres";

import { createDrizzleClient } from "../drizzle/client.ts";
import type { PostgresJsDatabase } from "../drizzle/types.ts";

export type IntegrationDatabase = Readonly<{
  database: PostgresJsDatabase;
  sql: postgres.Sql;
}>;

const integrationDatabaseLockKey = 32768012;
const dropAllTablesSql =
  "DROP TABLE IF EXISTS subgraph_revisions, subgraphs, graph_revisions, graphs CASCADE";
const schemaConstraintsSqlPath = new URL("../../db/schema-constraints.sql", import.meta.url);
const schemaSqlPath = new URL("../../db/schema.sql", import.meta.url);
const truncateAllDataSql =
  "TRUNCATE TABLE subgraph_revisions, subgraphs, graph_revisions, graphs CASCADE";

async function lockAndResetDatabase(sql: postgres.Sql): Promise<void> {
  await sql`SELECT pg_advisory_lock(${integrationDatabaseLockKey})`;
  await sql.unsafe(dropAllTablesSql);
  await sql.unsafe(await readFile(schemaSqlPath, "utf8"));
  await sql.unsafe(await readFile(schemaConstraintsSqlPath, "utf8"));
  await sql.unsafe(truncateAllDataSql);
}

export async function connectIntegrationDatabase(databaseUrl: string): Promise<{
  close: () => Promise<void>;
  database: IntegrationDatabase;
}> {
  const sql = postgres(databaseUrl, { max: 1 });

  const releaseLockAndEndClient = async (): Promise<void> => {
    await sql`SELECT pg_advisory_unlock(${integrationDatabaseLockKey})`;
    await sql.end({ timeout: 5 });
  };

  try {
    await lockAndResetDatabase(sql);
  } catch (error) {
    await releaseLockAndEndClient();
    throw error;
  }

  return {
    close: async () => {
      try {
        await sql.unsafe(truncateAllDataSql);
      } finally {
        await releaseLockAndEndClient();
      }
    },
    database: {
      database: createDrizzleClient({ client: sql }),
      sql,
    },
  };
}

export async function queryCount(sql: postgres.Sql, statement: string): Promise<number> {
  const rows = await sql.unsafe<
    Array<{
      count: bigint | number | string;
    }>
  >(statement);
  const count = rows[0]?.count;

  if (typeof count === "bigint") {
    return Number(count);
  }

  return Number(count ?? 0);
}
