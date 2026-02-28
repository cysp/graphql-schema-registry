// oxlint-disable eslint/require-await,typescript-eslint/require-await

import type { FastifyReply, FastifyRequest, RouteGenericInterface } from "fastify";

import type { AuthorizationGrant } from "../../../domain/authorization/user.ts";

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

function createGuard<RouteGeneric extends RouteGenericInterface>(
  matcher: GuardMatcher<FastifyRequest<RouteGeneric>>,
): (request: FastifyRequest<RouteGeneric>, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    const user = request.user;
    if (!user) {
      return reply.unauthorized();
    }

    if (!user.grants.some((grant) => matcher(grant, request))) {
      return reply.forbidden();
    }
  };
}

export const requireAdmin = createGuard<{ Params: AdminRouteParams }>(
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
