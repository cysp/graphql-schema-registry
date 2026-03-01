import postgres from "postgres";

import { createDrizzleClient } from "../drizzle/client.ts";
import type { PostgresJsDatabase } from "../drizzle/types.ts";

export type IntegrationDatabase = Readonly<{
  database: PostgresJsDatabase;
  sql: postgres.Sql;
}>;

const integrationDatabaseLockKey = 32768012;
const truncateAllDataSql =
  "TRUNCATE TABLE subgraph_revisions, subgraphs, graph_revisions, graphs RESTART IDENTITY CASCADE";

async function lockAndResetDatabase(sql: postgres.Sql): Promise<void> {
  await sql`SELECT pg_advisory_lock(${integrationDatabaseLockKey})`;
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

  const database = createDrizzleClient({ client: sql });

  return {
    close: async () => {
      try {
        await sql.unsafe(truncateAllDataSql);
      } finally {
        await releaseLockAndEndClient();
      }
    },
    database: {
      database,
      sql,
    },
  };
}
