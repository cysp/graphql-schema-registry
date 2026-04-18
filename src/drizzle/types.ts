import type { PostgresJsDatabase as DrizzlePostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";

import type * as schema from "./schema.ts";

export type PostgresJsDatabase = DrizzlePostgresJsDatabase<typeof schema> & {
  $client: Sql;
};
export type PostgresJsTransaction = Parameters<Parameters<PostgresJsDatabase["transaction"]>[0]>[0];
export type PostgresJsExecutor = PostgresJsDatabase | PostgresJsTransaction;
