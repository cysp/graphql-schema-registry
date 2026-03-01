import { z } from "zod";

import type { AuthorizationGrant } from "./user.ts";

export const authorizationDetailsType = "https://chikachow.org/graphql-schema-registry";

const authorizationDetailsTypeSchema = z.literal(authorizationDetailsType);
const uuidV4Schema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

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
    graph_id: uuidV4Schema,
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
    graph_id: uuidV4Schema,
    subgraph_id: uuidV4Schema,
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
