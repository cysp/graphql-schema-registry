import { z } from "zod";

const idSchema = z.string();

export const graphParamsSchema = z
  .object({
    graphId: idSchema,
  })
  .strict();

export const subgraphParamsSchema = z
  .object({
    graphId: idSchema,
    subgraphId: idSchema,
  })
  .strict();

export const createGraphBodySchema = z
  .object({
    graphId: idSchema,
  })
  .strict();

export const createSubgraphBodySchema = z
  .object({
    subgraphId: idSchema,
  })
  .strict();
