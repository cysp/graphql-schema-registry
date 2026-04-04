import { createHash } from "node:crypto";

import { parse, print } from "graphql";

export function normalizeSchemaSdl(schemaSdl: string): string {
  return `${print(parse(schemaSdl)).trim()}\n`;
}

export function hashNormalizedSchemaSdl(normalizedSdl: string): string {
  return createHash("sha256").update(normalizedSdl).digest("hex");
}
