import { z } from "zod";

import { decodeAuthorizationDetailsClaim } from "./details.ts";

export type GraphManageAuthorizationGrant = {
  scope: "graph:manage";
  graphId: string;
};

export type SupergraphSchemaReadAuthorizationGrant = {
  scope: "supergraph_schema:read";
  graphId: string;
};

export type SubgraphSchemaAuthorizationGrant = {
  scope: "subgraph_schema:read" | "subgraph_schema:validate" | "subgraph_schema:write";
  graphId: string;
  subgraphId: string;
};

export type AuthorizationGrant =
  | GraphManageAuthorizationGrant
  | SupergraphSchemaReadAuthorizationGrant
  | SubgraphSchemaAuthorizationGrant;

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
