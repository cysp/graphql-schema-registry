import type {
  ContextConfigDefault,
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerBase,
  RawServerDefault,
  RouteGenericInterface,
  RouteHandlerMethod,
  RouteOptions,
} from "fastify";
import type { JSONSchema } from "json-schema-to-ts";

import type { FastifyJsonSchemaToTsTypeProvider } from "../fastify-json-schema-to-ts-type-provider.ts";

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

export type FastifyJsonSchemaToTsInstance<
  RawServer extends RawServerBase = RawServerDefault,
  RawRequest extends RawRequestDefaultExpression<RawServer> =
    RawRequestDefaultExpression<RawServer>,
  RawReply extends RawReplyDefaultExpression<RawServer> = RawReplyDefaultExpression<RawServer>,
  Logger extends FastifyBaseLogger = FastifyBaseLogger,
> = FastifyInstance<RawServer, RawRequest, RawReply, Logger, FastifyJsonSchemaToTsTypeProvider>;

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
