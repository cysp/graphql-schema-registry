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

function resolveIntegrationSchemaName(): string {
  const schemaName = process.env["INTEGRATION_TEST_SCHEMA"]?.trim();
  if (schemaName === undefined || schemaName === "") {
    return "public";
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schemaName)) {
    throw new Error("INTEGRATION_TEST_SCHEMA must be a valid unquoted postgres identifier");
  }

  return schemaName;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function setSearchPath(sql: postgres.Sql, schemaName: string): Promise<void> {
  const quotedSchemaName = quoteIdentifier(schemaName);
  await sql.unsafe(`SET search_path TO ${quotedSchemaName}, public`);
}

async function lockAndResetDatabase(sql: postgres.Sql, schemaName: string): Promise<void> {
  await setSearchPath(sql, schemaName);
  await sql`SELECT pg_advisory_lock(${integrationDatabaseLockKey})`;
  await sql.unsafe(truncateAllDataSql);
}

export async function connectIntegrationDatabase(databaseUrl: string): Promise<{
  close: () => Promise<void>;
  database: IntegrationDatabase;
}> {
  const sql = postgres(databaseUrl, { max: 1 });
  const integrationSchemaName = resolveIntegrationSchemaName();
  const releaseLockAndEndClient = async (): Promise<void> => {
    await sql`SELECT pg_advisory_unlock(${integrationDatabaseLockKey})`;
    await sql.end({ timeout: 5 });
  };

  try {
    await lockAndResetDatabase(sql, integrationSchemaName);
  } catch (error) {
    await releaseLockAndEndClient();
    throw error;
  }

  const database = createDrizzleClient({ client: sql });

  return {
    close: async () => {
      try {
        await setSearchPath(sql, integrationSchemaName);
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
