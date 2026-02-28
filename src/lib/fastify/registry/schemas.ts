import { z } from "zod";

const slugSchema = z.string().trim().min(1);
const uuidSchema = z.uuid();
const revisionHeaderSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform(Number);

export const graphParamsSchema = z
  .object({
    graphId: slugSchema,
  })
  .strict();

export const subgraphParamsSchema = z
  .object({
    graphId: slugSchema,
    subgraphId: slugSchema,
  })
  .strict();

export const upsertHeadersSchema = z
  .object({
    "x-revision": revisionHeaderSchema,
  })
  .strict();

export const upsertGraphBodySchema = z
  .object({
    federationVersion: z.string().trim().min(1),
  })
  .strict();

export const graphSchema = z
  .object({
    id: uuidSchema,
    slug: slugSchema,
    revisionId: z.number().int().positive(),
    federationVersion: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const graphListSchema = z
  .object({
    items: z.array(graphSchema),
  })
  .strict();

export const upsertSubgraphBodySchema = z
  .object({
    routingUrl: z.url(),
  })
  .strict();

export const subgraphSchema = z
  .object({
    id: uuidSchema,
    slug: slugSchema,
    graphId: uuidSchema,
    revisionId: z.number().int().positive(),
    routingUrl: z.url(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const subgraphListSchema = z
  .object({
    items: z.array(subgraphSchema),
  })
  .strict();
