import type { FastifyReply } from "fastify";

export const DATABASE_NOT_CONFIGURED_MESSAGE = "Database is not configured.";
export const GRAPH_MISSING_CURRENT_REVISION_MESSAGE = "Graph is missing a current revision.";

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
