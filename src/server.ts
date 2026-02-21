import fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

import { databaseProbe } from "./db/probe.ts";
import { healthcheckPlugin } from "./lib/fastify/healthcheck/plugin.ts";

export function createFastifyServer(): FastifyInstance {
  const server = fastify({
    logger: true,
  });

  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  server.register(healthcheckPlugin, {
    probes: {
      database: databaseProbe,
    },
  });

  return server;
}
