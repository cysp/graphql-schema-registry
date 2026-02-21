import { sql } from "./client.ts";

await sql`SELECT 1`;
await sql.query("SELECT $1::text AS status", ["ok"]);
