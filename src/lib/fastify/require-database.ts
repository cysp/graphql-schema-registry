import type { FastifyReply } from "fastify";

import type { PostgresJsDatabase } from "../../drizzle/types.ts";

export function requireDatabase(
  database: PostgresJsDatabase | undefined,
  reply: FastifyReply,
): database is PostgresJsDatabase {
  if (database) {
    return true;
  }

  reply.problemDetails({ status: 503 });
  return false;
}
