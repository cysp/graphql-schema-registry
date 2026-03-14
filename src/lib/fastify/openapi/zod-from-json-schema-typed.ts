import type { FromSchema, JSONSchema } from "json-schema-to-ts";
import { z, type ZodType } from "zod";

export function zodFromJsonSchemaTyped<const Schema extends JSONSchema>(
  jsonSchema: Schema,
): ZodType<FromSchema<Schema>, FromSchema<Schema>>;
export function zodFromJsonSchemaTyped(
  jsonSchema: Parameters<typeof z.fromJSONSchema>[0],
): ZodType {
  return z.fromJSONSchema(jsonSchema);
}
