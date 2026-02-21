// oxlint-disable no-default-export, no-process-env

import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env["DATABASE_URL"];

if (typeof databaseUrl !== "string" || databaseUrl === "") {
  throw new Error("DATABASE_URL is required");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
