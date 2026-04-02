import type {
  ContextConfigDefault,
  FastifyReply,
  FastifySchema,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
  RouteGenericInterface,
} from "fastify";

import type { FastifyJsonSchemaToTsTypeProvider } from "./fastify-json-schema-to-ts-type-provider.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;

type Expect<Value extends true> = Value;

type MultiContentResponseSchema = {
  response: {
    200: {
      content: {
        "application/json": {
          schema: {
            additionalProperties: false;
            properties: {
              revision: {
                type: "string";
              };
            };
            required: ["revision"];
            type: "object";
          };
        };
        "text/plain": {
          schema: {
            type: "string";
          };
        };
      };
    };
  };
};

type JsonOnlyResponseSchema = {
  response: {
    201: {
      additionalProperties: false;
      properties: {
        id: {
          type: "string";
        };
      };
      required: ["id"];
      type: "object";
    };
  };
};

type ReplyForSchema<Schema extends FastifySchema> = FastifyReply<
  RouteGenericInterface,
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  ContextConfigDefault,
  Schema,
  FastifyJsonSchemaToTsTypeProvider
>;

declare const multiContentReply: ReplyForSchema<MultiContentResponseSchema>;
declare const jsonOnlyReply: ReplyForSchema<JsonOnlyResponseSchema>;

const multiContent200Reply = multiContentReply.code(200);
const jsonOnly201Reply = jsonOnlyReply.code(201);

type MultiContentPayload = Parameters<(typeof multiContent200Reply)["send"]>[0];
type JsonOnlyPayload = Parameters<(typeof jsonOnly201Reply)["send"]>[0];

export type MultiContentPayloadIsUnion = Expect<
  Equal<
    MultiContentPayload,
    | {
        revision: string;
      }
    | string
  >
>;
export type JsonOnlyPayloadUsesSchema = Expect<
  Equal<
    JsonOnlyPayload,
    {
      id: string;
    }
  >
>;
