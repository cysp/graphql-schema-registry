import type { FastifyPluginAsync } from "fastify";

import type { FastifyJsonSchemaToTsTypeProvider } from "../fastify-json-schema-to-ts-type-provider.ts";
import type { OpenApiOperationHandlers } from "./generated/routes.ts";
import { registerOpenApiRoutes } from "./generated/routes.ts";

export type { OpenApiOperationHandlers } from "./generated/routes.ts";

export const openApiRoutesPlugin: FastifyPluginAsync<{
  operationHandlers: OpenApiOperationHandlers;
}> = async (server, options) => {
  registerOpenApiRoutes(
    server.withTypeProvider<FastifyJsonSchemaToTsTypeProvider>(),
    options.operationHandlers,
  );
};
