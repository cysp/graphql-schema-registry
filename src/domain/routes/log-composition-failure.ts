import type { FastifyBaseLogger } from "fastify";

import type { CompositionAttemptOutcome } from "../supergraph-composition.ts";

export function logCompositionFailure(
  log: FastifyBaseLogger,
  context: Record<string, string>,
  composition: CompositionAttemptOutcome | undefined,
): void {
  if (composition?.kind !== "failed") {
    return;
  }

  log.warn(
    {
      ...context,
      errors: composition.errors.map((error) => error.message),
    },
    "supergraph composition failed",
  );
}
