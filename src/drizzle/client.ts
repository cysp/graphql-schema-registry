import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";

import drizzleConfig from "../../drizzle.config.ts";
import * as schema from "./schema.ts";
import type { PostgresJsDatabase } from "./types.ts";

export function createDrizzleClient({ client }: { client: postgres.Sql }): PostgresJsDatabase {
  return drizzle({ client, schema, casing: drizzleConfig.casing });
}
