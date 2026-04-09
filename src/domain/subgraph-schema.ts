import { createHash } from "node:crypto";

import { parse, print } from "graphql";

export function normalizeSchemaSdl(schemaSdl: string): string {
  return `${print(parse(schemaSdl)).trim()}\n`;
}

export function sha256NormalizedSchemaSdl(normalizedSdl: string): Buffer {
  return createHash("sha256").update(normalizedSdl).digest();
}
