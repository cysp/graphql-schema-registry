import type { FastifyInstance } from "fastify";

import { typedKeys } from "../../object.ts";
import { fastifyRouteDefinitionsByOperationId } from "./generated/route-definitions.ts";
import type { FastifyRouteHandlerFromSchema } from "./route-types.ts";

export type FastifyRouteDefinitionsByOperationId = typeof fastifyRouteDefinitionsByOperationId;

export type FastifyOperationId = keyof FastifyRouteDefinitionsByOperationId;

export type FastifyRouteDefinitionFor<OperationId extends FastifyOperationId> =
  FastifyRouteDefinitionsByOperationId[OperationId];

export type FastifyRouteSchemaFor<OperationId extends FastifyOperationId> =
  FastifyRouteDefinitionFor<OperationId>["schema"];

export type FastifyOperationHandlers = {
  [OperationId in FastifyOperationId]: FastifyRouteHandlerFromSchema<
    FastifyRouteSchemaFor<OperationId>
  >;
};

export const fastifyOperationIds = typedKeys(fastifyRouteDefinitionsByOperationId);

export function registerFastifyOperationRoute<OperationId extends FastifyOperationId>(
  server: FastifyInstance,
  operationHandlers: FastifyOperationHandlers,
  operationId: OperationId,
): void {
  const fastifyRouteDefinition: FastifyRouteDefinitionFor<OperationId> =
    fastifyRouteDefinitionsByOperationId[operationId];

  server.route({
    method: fastifyRouteDefinition.method,
    url: fastifyRouteDefinition.url,
    schema: fastifyRouteDefinition.schema,
    handler: operationHandlers[operationId],
  });
}
