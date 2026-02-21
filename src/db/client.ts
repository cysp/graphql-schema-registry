// oxlint-disable no-process-env

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema.ts";

const databaseUrl = process.env["DATABASE_URL"];

if (typeof databaseUrl !== "string" || databaseUrl === "") {
  throw new Error("DATABASE_URL is required");
}

export const sql = neon(databaseUrl);
export const db = drizzle(sql, { schema });
