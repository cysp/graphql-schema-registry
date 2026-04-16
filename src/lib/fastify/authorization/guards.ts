import type { FastifyReply, FastifyRequest } from "fastify";

import type { RequestUser } from "../../../domain/authorization/user.ts";
import { bearerAuthenticateHeaders } from "./bearer-authenticate-headers.ts";

type GuardRequest = Pick<FastifyRequest, "user">;
type GuardReply<Reply> = {
  problemDetails(options: Parameters<FastifyReply["problemDetails"]>[0]): Reply;
};

export function requireAuthenticatedUser<Reply>(
  request: GuardRequest,
  reply: GuardReply<Reply>,
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
