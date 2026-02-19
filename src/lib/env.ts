// oxlint-disable no-process-env

import { z } from "zod";

export type Env = {
  port: number;
};

const envSchema = z.object({
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
    port: parsedEnv.data.PORT,
  };
}
