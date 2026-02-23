import { z } from "zod";

import type { AuthorizationGrant } from "./user.ts";

export const authorizationDetailsType = "https://chikachow.org/graphql-schema-registry";

const authorizationDetailsTypeSchema = z.literal(authorizationDetailsType);

const adminAuthorizationDetailSchema = z
  .object({
    type: authorizationDetailsTypeSchema,
    scope: z.literal("admin"),
  })
  .strict()
  .transform((detail) => ({
    scope: detail.scope,
  }));

const graphAuthorizationDetailSchema = z
  .object({
    type: authorizationDetailsTypeSchema,
    scope: z.enum(["graph:read"]),
    graph_id: z.string(),
  })
  .strict()
  .transform((detail) => ({
    scope: detail.scope,
    graphId: detail.graph_id,
  }));

const subgraphAuthorizationDetailSchema = z
  .object({
    type: authorizationDetailsTypeSchema,
    scope: z.enum(["subgraph:write"]),
    graph_id: z.string(),
    subgraph_id: z.string(),
  })
  .strict()
  .transform((detail) => ({
    scope: detail.scope,
    graphId: detail.graph_id,
    subgraphId: detail.subgraph_id,
  }));

const authorizationDetailsClaimSchema = z
  .array(
    z.union([
      adminAuthorizationDetailSchema,
      graphAuthorizationDetailSchema,
      subgraphAuthorizationDetailSchema,
    ]),
  )
  .optional()
  .default([]);

export function decodeAuthorizationDetailsClaim(
  claimValue?: unknown,
): readonly AuthorizationGrant[] {
  return authorizationDetailsClaimSchema.parse(claimValue);
}
