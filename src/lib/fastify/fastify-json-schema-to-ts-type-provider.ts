import type { FastifyTypeProvider } from "fastify";
import type { FromSchema, JSONSchema } from "json-schema-to-ts";

type TypeProviderTypeFromSchema<Schema> = Schema extends JSONSchema ? FromSchema<Schema> : unknown;

export interface FastifyJsonSchemaToTsTypeProvider extends FastifyTypeProvider {
  serializer: TypeProviderTypeFromSchema<this["schema"]>;
  validator: TypeProviderTypeFromSchema<this["schema"]>;
}
