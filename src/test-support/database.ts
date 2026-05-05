import postgres from "postgres";

import { createDrizzleClient } from "../drizzle/client.ts";
import type { PostgresJsDatabase } from "../drizzle/types.ts";

export type IntegrationDatabase = Readonly<{
  database: PostgresJsDatabase;
  sql: postgres.Sql;
}>;

const integrationDatabaseLockKey = 32768012;
const truncateAllDataSql =
  "TRUNCATE TABLE graph_composition_subgraphs, supergraph_schemas, graph_compositions, subgraph_schema_revisions, subgraph_revisions, subgraphs, graph_revisions, graphs CASCADE";
const defaultClientOptions: postgres.Options<Record<string, postgres.PostgresType>> = { max: 1 };

function createIntegrationDatabaseClient(
  databaseUrl: string,
  options: postgres.Options<Record<string, postgres.PostgresType>> = defaultClientOptions,
): IntegrationDatabase {
  const sql = postgres(databaseUrl, options);
  return {
    database: createDrizzleClient({ client: sql }),
    sql,
  };
}

async function unlockDatabase(sql: postgres.Sql): Promise<void> {
  await sql`SELECT pg_advisory_unlock(${integrationDatabaseLockKey})`;
}

async function lockAndResetDatabase(sql: postgres.Sql): Promise<void> {
  await sql`SELECT pg_advisory_lock(${integrationDatabaseLockKey})`;
  await sql.unsafe(truncateAllDataSql);
}

export type IntegrationDatabaseEnvironment = Readonly<{
  close: () => Promise<void>;
  openSession: (
    options?: postgres.Options<Record<string, postgres.PostgresType>>,
  ) => Promise<IntegrationDatabase>;
  primary: IntegrationDatabase;
}>;

export async function createIntegrationDatabaseEnvironment(
  databaseUrl: string,
): Promise<IntegrationDatabaseEnvironment> {
  const primary = createIntegrationDatabaseClient(databaseUrl);
  const secondaryClients: postgres.Sql[] = [];

  const closeSecondaryClients = async (): Promise<void> => {
    await Promise.allSettled(
      secondaryClients.splice(0).map(async (sql) => sql.end({ timeout: 5 })),
    );
  };

  try {
    await lockAndResetDatabase(primary.sql);
  } catch (error) {
    try {
      await unlockDatabase(primary.sql);
    } catch {
      // Best effort: the connection close below is still the final cleanup path.
    } finally {
      await primary.sql.end({ timeout: 5 });
    }
    throw error;
  }

  return {
    close: async () => {
      try {
        await closeSecondaryClients();
        try {
          await unlockDatabase(primary.sql);
        } catch {
          // Best effort: release the advisory lock before ending the client when possible.
        }
      } finally {
        await primary.sql.end({ timeout: 5 });
      }
    },
    openSession: async (options = defaultClientOptions) => {
      const session = createIntegrationDatabaseClient(databaseUrl, options);
      secondaryClients.push(session.sql);
      return session;
    },
    primary,
  };
}

export async function connectIntegrationDatabase(databaseUrl: string): Promise<{
  close: () => Promise<void>;
  database: IntegrationDatabase;
}> {
  const environment = await createIntegrationDatabaseEnvironment(databaseUrl);

  return {
    close: environment.close,
    database: environment.primary,
  };
}

export async function queryCount(
  sql: postgres.Sql,
  statement: string,
  parameters?: Parameters<postgres.Sql["unsafe"]>[1],
): Promise<number> {
  const rows = await sql.unsafe<
    Array<{
      count: bigint | number | string;
    }>
  >(statement, parameters);
  const count = rows[0]?.count;

  if (typeof count === "bigint") {
    return Number(count);
  }

  return Number(count ?? 0);
}
