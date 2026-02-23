import { z } from "zod";

import { decodeAuthorizationDetailsClaim } from "./details.ts";

export type AdminAuthorizationGrant = {
  scope: "admin";
};

export type GraphAuthorizationGrant = {
  scope: "graph:read";
  graphId: string;
};

export type SubgraphAuthorizationGrant = {
  scope: "subgraph:write";
  graphId: string;
  subgraphId: string;
};

export type AuthorizationGrant =
  | AdminAuthorizationGrant
  | GraphAuthorizationGrant
  | SubgraphAuthorizationGrant;

export type RequestUser = {
  grants: readonly AuthorizationGrant[];
};

declare module "@fastify/jwt" {
  interface FastifyJWT {
    user: RequestUser | undefined;
  }
}

const jwtClaimsSchema = z
  .object({
    authorization_details: z.unknown().optional(),
  })
  .loose();

export function formatUser(payload: unknown): RequestUser {
  const claims = jwtClaimsSchema.parse(payload);

  return {
    grants: decodeAuthorizationDetailsClaim(claims.authorization_details),
  };
}
