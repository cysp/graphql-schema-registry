import { z } from "zod";

import type { AuthorizationGrant } from "./user.ts";

export const authorizationDetailsType = "https://chikachow.org/graphql-schema-registry";

const authorizationDetailsTypeSchema = z.literal(authorizationDetailsType);
const resourceIdSchema = z.string().min(1);

const graphManageAuthorizationDetailSchema = z
  .object({
    type: authorizationDetailsTypeSchema,
    scope: z.literal("graph:manage"),
    graph_id: resourceIdSchema,
  })
  .strict()
  .transform((detail) => ({
    scope: detail.scope,
    graphId: detail.graph_id,
  }));

const supergraphSchemaReadAuthorizationDetailSchema = z
  .object({
    type: authorizationDetailsTypeSchema,
    scope: z.literal("supergraph_schema:read"),
    graph_id: resourceIdSchema,
  })
  .strict()
  .transform((detail) => ({
    scope: detail.scope,
    graphId: detail.graph_id,
  }));

const subgraphSchemaAuthorizationDetailSchema = z
  .object({
    type: authorizationDetailsTypeSchema,
    scope: z.enum(["subgraph_schema:read", "subgraph_schema:write"]),
    graph_id: resourceIdSchema,
    subgraph_id: resourceIdSchema,
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
      graphManageAuthorizationDetailSchema,
      supergraphSchemaReadAuthorizationDetailSchema,
      subgraphSchemaAuthorizationDetailSchema,
    ]),
  )
  .optional()
  .default([]);

export function decodeAuthorizationDetailsClaim(
  claimValue?: unknown,
): readonly AuthorizationGrant[] {
  return authorizationDetailsClaimSchema.parse(claimValue);
}
