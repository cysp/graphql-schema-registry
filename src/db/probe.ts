import { sql } from "./client.ts";

export async function databaseProbe(): Promise<"ok"> {
  await sql`SELECT 1`;
  return "ok";
}
