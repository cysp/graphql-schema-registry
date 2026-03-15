import type { FastifyReply, FastifyRequest } from "fastify";

import type { RequestUser } from "../../../domain/authorization/user.ts";
import { bearerAuthenticateHeaders } from "./bearer-authenticate-headers.ts";

export function requireAuthenticatedUser(
  request: FastifyRequest,
  reply: FastifyReply,
): RequestUser | undefined {
  const user = request.user;
  if (!user) {
    reply.problemDetails({
      status: 401,
      headers: bearerAuthenticateHeaders,
    });
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
    reply.problemDetails({ status: 403 });
    return undefined;
  }

  return user;
}
