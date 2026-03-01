import type { FastifyReply, FastifyRequest } from "fastify";

import type { RequestUser } from "../../../domain/authorization/user.ts";

export function requireAuthenticatedUser(
  request: FastifyRequest,
  reply: FastifyReply,
): RequestUser | undefined {
  const user = request.user;
  if (!user) {
    reply.unauthorized();
    return undefined;
  }

  return user;
}

export function requireAdminUser(
  request: FastifyRequest,
  reply: FastifyReply,
): RequestUser | undefined {
  const user = requireAuthenticatedUser(request, reply);
  if (!user) {
    return undefined;
  }

  if (!user.grants.some((grant) => grant.scope === "admin")) {
    reply.forbidden();
    return undefined;
  }

  return user;
}
