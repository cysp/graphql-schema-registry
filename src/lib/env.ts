// oxlint-disable no-process-env

import { z } from "zod";

import { optionalNonBlankString } from "./zod.ts";

type EnvJwtVerification = {
  audience: string;
  issuer: string;
  publicKeyPath: string;
};

export type Env = {
  host: string;
  port: number;
  databaseUrl: string | undefined;
  jwtVerification: EnvJwtVerification | undefined;
};

const envSchema = z
  .object({
    HOST: z.string().trim().min(1).default("0.0.0.0"),
    PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
    DATABASE_URL: optionalNonBlankString,
    AUTH_JWT_PUBLIC_KEY_PATH: optionalNonBlankString,
    AUTH_JWT_ISSUER: optionalNonBlankString,
    AUTH_JWT_AUDIENCE: optionalNonBlankString,
  })
  .superRefine((value, context) => {
    const hasPublicKeyPath = value.AUTH_JWT_PUBLIC_KEY_PATH !== undefined;
    const hasIssuer = value.AUTH_JWT_ISSUER !== undefined;
    const hasAudience = value.AUTH_JWT_AUDIENCE !== undefined;

    const configuredFieldCount = [hasPublicKeyPath, hasIssuer, hasAudience].filter(Boolean).length;
    if (configuredFieldCount !== 0 && configuredFieldCount !== 3) {
      if (!hasPublicKeyPath) {
        context.addIssue({
          code: "custom",
          path: ["AUTH_JWT_PUBLIC_KEY_PATH"],
          message: hasIssuer
            ? "AUTH_JWT_PUBLIC_KEY_PATH is required when AUTH_JWT_ISSUER is set."
            : "AUTH_JWT_PUBLIC_KEY_PATH is required when AUTH_JWT_AUDIENCE is set.",
        });
      }

      if (!hasIssuer) {
        context.addIssue({
          code: "custom",
          path: ["AUTH_JWT_ISSUER"],
          message: "AUTH_JWT_ISSUER is required when AUTH_JWT_PUBLIC_KEY_PATH is set.",
        });
      }

      if (!hasAudience) {
        context.addIssue({
          code: "custom",
          path: ["AUTH_JWT_AUDIENCE"],
          message: "AUTH_JWT_AUDIENCE is required when AUTH_JWT_PUBLIC_KEY_PATH is set.",
        });
      }
    }
  });

export function parseEnv(env: typeof process.env = process.env): Env {
  const parsedEnv = envSchema.safeParse(env);

  if (!parsedEnv.success) {
    throw new Error(
      parsedEnv.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }

  const jwtVerification =
    parsedEnv.data.AUTH_JWT_PUBLIC_KEY_PATH &&
    parsedEnv.data.AUTH_JWT_ISSUER &&
    parsedEnv.data.AUTH_JWT_AUDIENCE
      ? {
          audience: parsedEnv.data.AUTH_JWT_AUDIENCE,
          issuer: parsedEnv.data.AUTH_JWT_ISSUER,
          publicKeyPath: parsedEnv.data.AUTH_JWT_PUBLIC_KEY_PATH,
        }
      : undefined;

  return {
    databaseUrl: parsedEnv.data.DATABASE_URL,
    host: parsedEnv.data.HOST,
    jwtVerification,
    port: parsedEnv.data.PORT,
  };
}
