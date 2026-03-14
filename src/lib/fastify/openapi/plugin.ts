import { fastifyPlugin } from "fastify-plugin";
import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { fastifyOperationIds, registerFastifyOperationRoute } from "./routes.ts";
import type { FastifyOperationHandlers } from "./routes.ts";

export type FastifyOpenApiRoutesPluginOptions = {
  operationHandlers: FastifyOperationHandlers;
};

const fastifyOpenApiRoutesPluginImpl: FastifyPluginCallbackZod<
  FastifyOpenApiRoutesPluginOptions
> = (server, options, done): void => {
  for (const operationId of fastifyOperationIds) {
    registerFastifyOperationRoute(server, options.operationHandlers, operationId);
  }

  done();
};

export const fastifyOpenApiRoutesPlugin = fastifyPlugin(fastifyOpenApiRoutesPluginImpl, {
  name: "fastify-openapi-routes",
});
