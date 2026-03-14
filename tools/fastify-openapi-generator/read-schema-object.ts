import { GeneratorError } from "./errors.ts";
import type { JsonSchemaObject } from "./types.ts";
import {
  readOptionalRecord,
  readOptionalString,
  readRecord,
  readStringArray,
} from "./value-readers.ts";

const unsupportedSchemaKeywords = [
  "allOf",
  "anyOf",
  "const",
  "enum",
  "not",
  "nullable",
  "oneOf",
] as const;

export type ReadJsonSchemaObject = (value: unknown, context: string) => JsonSchemaObject;

function readOptionalInteger(value: unknown, context: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new GeneratorError(`${context} must be a non-negative integer.`);
  }

  return value;
}

export function createJsonSchemaObjectReader(): ReadJsonSchemaObject {
  const schemasBySource = new WeakMap<object, JsonSchemaObject>();

  function readJsonSchemaObject(value: unknown, context: string): JsonSchemaObject {
    const sourceSchema = readRecord(value, context);
    const cachedSchema = schemasBySource.get(sourceSchema);
    if (cachedSchema !== undefined) {
      return cachedSchema;
    }

    const schema: JsonSchemaObject = {};
    schemasBySource.set(sourceSchema, schema);

    for (const unsupportedKeyword of unsupportedSchemaKeywords) {
      if (sourceSchema[unsupportedKeyword] !== undefined) {
        throw new GeneratorError(`${context} uses unsupported "${unsupportedKeyword}".`);
      }
    }

    const ref = readOptionalString(sourceSchema["$ref"], `${context}.$ref`);
    if (ref !== undefined) {
      schema.$ref = ref;
    }

    const description = readOptionalString(sourceSchema["description"], `${context}.description`);
    if (description !== undefined) {
      schema.description = description;
    }

    const schemaType = readOptionalString(sourceSchema["type"], `${context}.type`);
    if (schemaType !== undefined) {
      if (schemaType !== "array" && schemaType !== "object" && schemaType !== "string") {
        throw new GeneratorError(`${context}.type "${schemaType}" is unsupported.`);
      }

      schema.type = schemaType;
    }

    const format = readOptionalString(sourceSchema["format"], `${context}.format`);
    if (format !== undefined) {
      schema.format = format;
    }

    const pattern = readOptionalString(sourceSchema["pattern"], `${context}.pattern`);
    if (pattern !== undefined) {
      schema.pattern = pattern;
    }

    const minLength = readOptionalInteger(sourceSchema["minLength"], `${context}.minLength`);
    if (minLength !== undefined) {
      schema.minLength = minLength;
    }

    const maxLength = readOptionalInteger(sourceSchema["maxLength"], `${context}.maxLength`);
    if (maxLength !== undefined) {
      schema.maxLength = maxLength;
    }

    const requiredPropertyNames = sourceSchema["required"];
    if (requiredPropertyNames !== undefined) {
      schema.required = readStringArray(requiredPropertyNames, `${context}.required`);
    }

    const propertySchemas = readOptionalRecord(sourceSchema["properties"], `${context}.properties`);
    if (propertySchemas !== undefined) {
      const properties: Record<string, JsonSchemaObject> = {};

      for (const propertyName of Object.keys(propertySchemas).toSorted()) {
        properties[propertyName] = readJsonSchemaObject(
          propertySchemas[propertyName],
          `${context}.properties.${propertyName}`,
        );
      }

      schema.properties = properties;
    }

    const itemSchema = sourceSchema["items"];
    if (itemSchema !== undefined) {
      schema.items = readJsonSchemaObject(itemSchema, `${context}.items`);
    }

    const additionalProperties = sourceSchema["additionalProperties"];
    if (additionalProperties !== undefined) {
      if (typeof additionalProperties !== "boolean") {
        throw new GeneratorError(`${context}.additionalProperties must be a boolean.`);
      }

      schema.additionalProperties = additionalProperties;
    }

    return schema;
  }

  return readJsonSchemaObject;
}
