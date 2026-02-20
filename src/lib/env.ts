// oxlint-disable no-process-env

import { z } from "zod";

import { optionalNonBlankString } from "./zod.ts";

export type Env = {
  host: string;
  port: number;
  databaseUrl: string | undefined;
};

const envSchema = z.object({
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
  DATABASE_URL: optionalNonBlankString,
});

export function parseEnv(env: typeof process.env = process.env): Env {
  const parsedEnv = envSchema.safeParse(env);

  if (!parsedEnv.success) {
    throw new Error(
      parsedEnv.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }

  return {
    databaseUrl: parsedEnv.data.DATABASE_URL,
    host: parsedEnv.data.HOST,
    port: parsedEnv.data.PORT,
  };
}
