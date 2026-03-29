import type { FastifyReply, FastifyRequest } from "fastify";

import type { AuthorizationGrant, RequestUser } from "../../../domain/authorization/user.ts";
import type { ProblemDetailsStatusCode } from "../problem-details/status-code.ts";
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

export function userHasGrant(
  user: RequestUser,
  predicate: (grant: AuthorizationGrant) => boolean,
): boolean {
  return user.grants.some(predicate);
}

export function hasGraphReadGrant(user: RequestUser, graphId: string): boolean {
  return userHasGrant(user, (grant) => grant.scope === "graph:read" && grant.graphId === graphId);
}

export function hasSubgraphWriteGrant(
  user: RequestUser,
  graphId: string,
  subgraphId: string,
): boolean {
  return userHasGrant(
    user,
    (grant) =>
      grant.scope === "subgraph:write" &&
      grant.graphId === graphId &&
      grant.subgraphId === subgraphId,
  );
}

export function requireGrant(
  request: FastifyRequest,
  reply: FastifyReply,
  predicate: (grant: AuthorizationGrant) => boolean,
  options?: {
    deniedStatus?: ProblemDetailsStatusCode;
  },
): RequestUser | undefined {
  const user = requireAuthenticatedUser(request, reply);
  if (!user) {
    return undefined;
  }

  if (!userHasGrant(user, predicate)) {
    reply.problemDetails({ status: options?.deniedStatus ?? 403 });
    return undefined;
  }

  return user;
}

export function requireAdminUser(
  request: FastifyRequest,
  reply: FastifyReply,
): RequestUser | undefined {
  return requireGrant(request, reply, (grant) => grant.scope === "admin");
}
