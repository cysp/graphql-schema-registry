import type { FastifyReply } from "fastify";

export const DATABASE_NOT_CONFIGURED_MESSAGE = "Database is not configured.";

export function requireDatabase<TDatabase extends object>(
  database: TDatabase | undefined,
  reply: FastifyReply,
): database is TDatabase {
  if (database) {
    return true;
  }

  reply.serviceUnavailable(DATABASE_NOT_CONFIGURED_MESSAGE);
  return false;
}
