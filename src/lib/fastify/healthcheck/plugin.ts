import type { FastifyPluginCallback } from "fastify";

import { executeProbes } from "./probes.ts";
import { responseJsonSchema } from "./schemas.ts";
import { determineOverallStatus } from "./status.ts";
import type { Probe } from "./types.ts";

export type HealthcheckPluginOptions = {
  probes: Readonly<Record<string, Probe>>;
};

export const healthcheckPlugin: FastifyPluginCallback<HealthcheckPluginOptions> = (
  server,
  options,
  done,
): void => {
  server.get(
    "/health",
    {
      schema: {
        response: {
          200: responseJsonSchema,
          503: responseJsonSchema,
        },
      },
    },
    async (_, reply) => {
      const checks = await executeProbes(options.probes);

      const status = determineOverallStatus(checks);
      const statusCode = status === "error" ? 503 : 200;

      reply.code(statusCode);

      return { status, checks };
    },
  );

  done();
};
