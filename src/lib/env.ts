// oxlint-disable no-process-env

import { z } from "zod";

export type Env = {
  databaseUrl: string;
  host: string;
  port: number;
};

const envSchema = z.object({
  DATABASE_URL: z.string().trim().min(1),
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
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
