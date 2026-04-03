import type { JsonSchemaToTsProvider } from "@fastify/type-provider-json-schema-to-ts";
import type { FastifyPluginAsync, RawServerDefault } from "fastify";

import type { FastifyRouteDefinition, FastifyRouteHandlerFromDefinition } from "./route-types.ts";

export type OpenApiOperationHandlers<
  OperationId extends string,
  Routes extends Record<OperationId, FastifyRouteDefinition>,
> = {
  [OperationId in keyof Routes]: FastifyRouteHandlerFromDefinition<Routes[OperationId]>;
};

export function openApiRoutesPlugin<
  OperationId extends string,
  Routes extends Record<OperationId, FastifyRouteDefinition>,
>(
  routeDefinitions: Routes,
): FastifyPluginAsync<
  {
    operationHandlers: OpenApiOperationHandlers<OperationId, Routes>;
  },
  RawServerDefault,
  JsonSchemaToTsProvider
> {
  return async (server, { operationHandlers }) => {
    for (const operationId in routeDefinitions) {
      const routeDefinition = routeDefinitions[operationId];
      const handler = operationHandlers[operationId];

      server.route({
        ...routeDefinition,
        handler,
      });
    }
  };
}
