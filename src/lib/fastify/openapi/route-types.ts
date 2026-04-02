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

import type { FastifyJsonSchemaToTsTypeProvider } from "../fastify-json-schema-to-ts-type-provider.ts";

type FastifyResponseStatusCode = number | `${number}`;

type FastifyRouteResponseSchema = {
  content?: Record<string, { schema: JSONSchema }>;
};

export type FastifyRouteSchema = {
  body?: JSONSchema;
  headers?: JSONSchema;
  params?: JSONSchema;
  querystring?: JSONSchema;
  response: Partial<Record<FastifyResponseStatusCode, FastifyRouteResponseSchema>>;
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
    FastifyJsonSchemaToTsTypeProvider
  >;
