import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";

import { relations } from "./relations.ts";
import type { PostgresJsDatabase } from "./types.ts";

export function createDrizzleClient({ client }: { client: postgres.Sql }): PostgresJsDatabase {
  return drizzle({ client, relations });
}
