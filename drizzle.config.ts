// oxlint-disable import/no-default-export

import type { Config } from "drizzle-kit";

export default {
  casing: "snake_case",
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/drizzle/schema.ts",
  strict: true,
  verbose: true,
} as Config;
