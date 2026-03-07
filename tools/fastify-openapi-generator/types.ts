import type { JSONSchema } from "json-schema-to-ts";

export type JsonSchema = Exclude<JSONSchema, boolean>;

export type NormalizedRouteSchema = {
  body?: JsonSchema;
  headers?: JsonSchema;
  params?: JsonSchema;
  querystring?: JsonSchema;
  response: Record<string, JsonSchema | undefined>;
};

export type NormalizedOperation = {
  method: "DELETE" | "GET" | "POST" | "PUT";
  operationId: string;
  schema: NormalizedRouteSchema;
  url: string;
};

export type GeneratedFile = {
  content: string;
  relativePath: string;
};
