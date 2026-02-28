// oxlint-disable eslint/require-await,typescript-eslint/require-await

import type { FastifyReply, FastifyRequest, RouteGenericInterface } from "fastify";

import type { AuthorizationGrant, RequestUser } from "../../../domain/authorization/user.ts";

export type AdminRouteParams = unknown;

export type GraphRouteParams = {
  graphSlug: string;
};

export type SubgraphRouteParams = {
  graphSlug: string;
  subgraphSlug: string;
};

type GuardMatcher<TRequest extends FastifyRequest> = (
  grant: AuthorizationGrant,
  request: TRequest,
) => boolean;

export function getAuthenticatedUser(
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
  const user = getAuthenticatedUser(request, reply);
  if (!user) {
    return undefined;
  }

  if (!user.grants.some((grant) => grant.scope === "admin")) {
    reply.forbidden();
    return undefined;
  }

  return user;
}

function createGuard<RouteGeneric extends RouteGenericInterface>(
  matcher: GuardMatcher<FastifyRequest<RouteGeneric>>,
): (request: FastifyRequest<RouteGeneric>, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    const user = getAuthenticatedUser(request, reply);
    if (!user) {
      return;
    }

    if (!user.grants.some((grant) => matcher(grant, request))) {
      reply.forbidden();
    }
  };
}

export const requireAdmin = createGuard<RouteGenericInterface>(
  (grant) => grant.scope === "admin",
);

export const requireGraphRead = createGuard<{
  Params: GraphRouteParams;
}>((grant, request) => grant.scope === "graph:read" && grant.graphId === request.params.graphSlug);

export const requireSubgraphWrite = createGuard<{
  Params: SubgraphRouteParams;
}>(
  (grant, request) =>
    grant.scope === "subgraph:write" &&
    grant.graphId === request.params.graphSlug &&
    grant.subgraphId === request.params.subgraphSlug,
);
