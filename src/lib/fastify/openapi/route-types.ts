import type {
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
  RouteHandlerMethod,
} from "fastify";
import type { z } from "zod";

type EmptyObject = Record<never, never>;

export type FastifyRouteSchema = {
  response: Record<PropertyKey, z.ZodType>;
};

type ReplyByStatusFromFastifyRouteSchema<RouteSchema extends FastifyRouteSchema> = {
  [Status in keyof RouteSchema["response"]]: z.output<RouteSchema["response"][Status]>;
};

type FastifyRequestTypesFromSchema<RouteSchema extends FastifyRouteSchema> = (RouteSchema extends {
  body: z.ZodType;
}
  ? { Body: z.input<RouteSchema["body"]> }
  : EmptyObject) &
  (RouteSchema extends { headers: z.ZodType }
    ? { Headers: z.input<RouteSchema["headers"]> }
    : EmptyObject) &
  (RouteSchema extends { params: z.ZodType }
    ? { Params: z.input<RouteSchema["params"]> }
    : EmptyObject) &
  (RouteSchema extends { querystring: z.ZodType }
    ? { Querystring: z.input<RouteSchema["querystring"]> }
    : EmptyObject);

type FastifyRouteGenericFromSchema<RouteSchema extends FastifyRouteSchema> =
  FastifyRequestTypesFromSchema<RouteSchema> & {
    Reply: ReplyByStatusFromFastifyRouteSchema<RouteSchema>;
  };

export type FastifyRouteHandlerFromSchema<RouteSchema extends FastifyRouteSchema> =
  RouteHandlerMethod<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    FastifyRouteGenericFromSchema<RouteSchema>
  >;
