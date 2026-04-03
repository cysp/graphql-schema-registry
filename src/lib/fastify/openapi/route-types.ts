import type { JsonSchemaToTsProvider } from "@fastify/type-provider-json-schema-to-ts";
import type {
  ContextConfigDefault,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
  RouteGenericInterface,
  RouteHandlerMethod,
  RouteOptions,
} from "fastify";
import type { JSONSchema } from "json-schema-to-ts";

type FastifyResponseStatusCode = number | `${number}`;

export type FastifyRouteSchema = {
  body?: JSONSchema;
  headers?: JSONSchema;
  params?: JSONSchema;
  querystring?: JSONSchema;
  response: Partial<Record<FastifyResponseStatusCode, JSONSchema>>;
};

export type FastifyRouteDefinition = Pick<RouteOptions, "method" | "url"> & {
  schema: FastifyRouteSchema;
};

export type FastifyRouteHandlerFromDefinition<RouteDefinition extends FastifyRouteDefinition> =
  RouteHandlerMethod<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    RouteGenericInterface,
    ContextConfigDefault,
    RouteDefinition["schema"],
    JsonSchemaToTsProvider
  >;
