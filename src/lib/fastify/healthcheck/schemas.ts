import type { JSONSchema } from "json-schema-to-ts";

export const checkStatusJsonSchema = {
  type: "string",
  enum: ["ok", "warn", "error"],
} as const satisfies JSONSchema;

export const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "checks"],
  properties: {
    status: checkStatusJsonSchema,
    checks: {
      type: "object",
      additionalProperties: checkStatusJsonSchema,
    },
  },
} as const satisfies JSONSchema;
