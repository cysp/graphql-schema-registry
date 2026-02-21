import fastifyPlugin from "fastify-plugin";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { executeProbes } from "./probes.ts";
import { responseSchema } from "./schemas.ts";
import { determineOverallStatus } from "./status.ts";
import type { Probe } from "./types.ts";

export type HealthcheckPluginOptions = {
  probes: Readonly<Record<string, Probe>>;
};

const healthcheckPluginImpl: FastifyPluginCallbackZod<HealthcheckPluginOptions> = (
  server,
  options,
  done,
): void => {
  server.get(
    "/health",
    {
      schema: {
        response: {
          200: responseSchema,
          503: responseSchema,
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

export const healthcheckPlugin = fastifyPlugin(healthcheckPluginImpl, {
  fastify: "5.x",
  name: "healthcheck",
});
