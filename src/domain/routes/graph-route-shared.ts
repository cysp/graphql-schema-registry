import type { FastifyReply } from "fastify";

export function requireDatabase<TDatabase extends object>(
  database: TDatabase | undefined,
  reply: FastifyReply,
): database is TDatabase {
  if (database) {
    return true;
  }

  reply.serviceUnavailable();
  return false;
}
