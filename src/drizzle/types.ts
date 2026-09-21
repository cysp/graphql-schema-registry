import type { PostgresJsDatabase as DrizzlePostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { relations } from "./relations.ts";

export type PostgresJsDatabase = DrizzlePostgresJsDatabase<typeof relations>;
export type PostgresJsTransaction = Parameters<Parameters<PostgresJsDatabase["transaction"]>[0]>[0];
export type PostgresJsExecutor = PostgresJsDatabase | PostgresJsTransaction;
