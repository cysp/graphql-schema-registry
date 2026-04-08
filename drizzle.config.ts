// oxlint-disable import/no-default-export, no-process-env

import type { Config } from "drizzle-kit";

const databaseUrl = process.env["DATABASE_URL"];

export default {
  casing: "snake_case",
  dbCredentials: {
    url: databaseUrl,
  },
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/drizzle/schema.ts",
  strict: true,
  verbose: true,
} as Config;
