import type { FastifyReply } from "fastify";

export function requireDependency<TDependency extends object>(
  dependency: TDependency | undefined,
  reply: FastifyReply,
): dependency is TDependency {
  if (dependency) {
    return true;
  }

  reply.serviceUnavailable();
  return false;
}
