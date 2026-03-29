import type { FastifyReply, FastifyRequest } from "fastify";

import type { AuthorizationGrant, RequestUser } from "../../../domain/authorization/user.ts";
import { bearerAuthenticateHeaders } from "./bearer-authenticate-headers.ts";

type GuardRequest = Pick<FastifyRequest, "user">;
type GuardReply = {
  problemDetails(options: Parameters<FastifyReply["problemDetails"]>[0]): void;
};

export function requireAuthenticatedUser(
  request: GuardRequest,
  reply: GuardReply,
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

function requireGrant(
  request: GuardRequest,
  reply: GuardReply,
  predicate: (grant: AuthorizationGrant) => boolean,
): RequestUser | undefined {
  const user = requireAuthenticatedUser(request, reply);
  if (!user) {
    return undefined;
  }

  if (!user.grants.some(predicate)) {
    reply.problemDetails({ status: 403 });
    return undefined;
  }

  return user;
}

function adminGrantPredicate(grant: AuthorizationGrant): boolean {
  return grant.scope === "admin";
}

export function requireAdminGrant(
  request: GuardRequest,
  reply: GuardReply,
): RequestUser | undefined {
  return requireGrant(request, reply, adminGrantPredicate);
}

function makeGraphReadGrantPredicate(graphId: string): (grant: AuthorizationGrant) => boolean {
  return (grant) => grant.scope === "graph:read" && grant.graphId === graphId;
}

export function requireGraphReadGrant(
  request: GuardRequest,
  reply: GuardReply,
  graphId: string,
): RequestUser | undefined {
  return requireGrant(request, reply, makeGraphReadGrantPredicate(graphId));
}

function makeSubgraphWriteGrantPredicate(
  graphId: string,
  subgraphId: string,
): (grant: AuthorizationGrant) => boolean {
  return (grant) =>
    grant.scope === "subgraph:write" &&
    grant.graphId === graphId &&
    grant.subgraphId === subgraphId;
}

export function requireSubgraphWriteGrant(
  request: GuardRequest,
  reply: GuardReply,
  graphId: string,
  subgraphId: string,
): RequestUser | undefined {
  return requireGrant(request, reply, makeSubgraphWriteGrantPredicate(graphId, subgraphId));
}
