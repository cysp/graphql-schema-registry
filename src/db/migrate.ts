import { migrate } from "drizzle-orm/neon-http/migrator";

import { db } from "./client.ts";

await migrate(db, {
  migrationsFolder: "drizzle",
});
