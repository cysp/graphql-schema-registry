import type { PostgresJsDatabase as DrizzlePostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { relations } from "./relations.ts";
import type * as schema from "./schema.ts";

export type PostgresJsDatabase = DrizzlePostgresJsDatabase<typeof schema, typeof relations>;
