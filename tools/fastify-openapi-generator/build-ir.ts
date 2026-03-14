// oxlint-disable eslint/max-lines

import { GeneratorError } from "./errors.ts";
import { isValidIdentifier, toComponentSchemaVariableName, toFastifyPath } from "./naming.ts";
import { createJsonSchemaObjectReader, type ReadJsonSchemaObject } from "./read-schema-object.ts";
import type {
  OpenApiComponentSchema,
  OpenApiRouteCatalog,
  OpenApiOperation,
  OpenApiOperationResponse,
  JsonSchemaObject,
} from "./types.ts";
import {
  readNonEmptyString,
  readOptionalArray,
  readOptionalBoolean,
  readOptionalRecord,
  readOptionalString,
  readRecord,
} from "./value-readers.ts";

const supportedOpenApiMethods = ["get", "post", "put", "delete"] as const;
type SupportedOpenApiMethod = (typeof supportedOpenApiMethods)[number];
type ResolvedParameter = {
  in: "header" | "path" | "query";
  name: string;
  required?: boolean;
  schema: JsonSchemaObject;
};

const httpMethodNames: Record<SupportedOpenApiMethod, OpenApiOperation["httpMethod"]> = {
  delete: "DELETE",
  get: "GET",
  post: "POST",
  put: "PUT",
};

function readOperationId(value: unknown, operationContext: string): string {
  const operationId = readOptionalString(value, `${operationContext}.operationId`)?.trim();
  if (!operationId) {
    throw new GeneratorError(`${operationContext} must define a non-empty operationId.`);
  }

  if (!isValidIdentifier(operationId)) {
    throw new GeneratorError(
      `${operationContext}.operationId "${operationId}" must be a valid TypeScript identifier.`,
    );
  }

  return operationId;
}

function readParameterLocation(value: unknown, context: string): ResolvedParameter["in"] {
  const parameterLocation = readNonEmptyString(value, context);

  if (
    parameterLocation !== "header" &&
    parameterLocation !== "path" &&
    parameterLocation !== "query"
  ) {
    throw new GeneratorError(
      `${context} uses unsupported parameter location "${parameterLocation}". Supported locations: path, query, header.`,
    );
  }

  return parameterLocation;
}

function readParameters(
  value: unknown,
  context: string,
  readJsonSchemaObject: ReadJsonSchemaObject,
): ResolvedParameter[] {
  const parameterValues = readOptionalArray(value, context);
  if (parameterValues === undefined) {
    return [];
  }

  return parameterValues.map((parameterValue, index) => {
    const parameterContext = `${context}[${index}]`;
    const parameter = readRecord(parameterValue, parameterContext);
    const parameterLocation = readParameterLocation(parameter["in"], `${parameterContext}.in`);
    const required = readOptionalBoolean(parameter["required"], `${parameterContext}.required`);

    if (parameterLocation === "path" && required !== true) {
      throw new GeneratorError(`${parameterContext} path parameter must set required: true.`);
    }

    const resolvedParameter: ResolvedParameter = {
      in: parameterLocation,
      name: readNonEmptyString(parameter["name"], `${parameterContext}.name`),
      schema: readJsonSchemaObject(parameter["schema"], `${parameterContext}.schema`),
    };

    if (required !== undefined) {
      resolvedParameter.required = required;
    }

    return resolvedParameter;
  });
}

function getParameterKey(parameter: ResolvedParameter): string {
  const normalizedName = parameter.in === "header" ? parameter.name.toLowerCase() : parameter.name;
  return `${parameter.in}:${normalizedName}`;
}

function mergeParameters(
  pathParameters: readonly ResolvedParameter[],
  operationParameters: readonly ResolvedParameter[],
): ResolvedParameter[] {
  const parametersByKey = new Map<string, ResolvedParameter>();

  for (const parameter of pathParameters) {
    parametersByKey.set(getParameterKey(parameter), parameter);
  }

  for (const parameter of operationParameters) {
    parametersByKey.set(getParameterKey(parameter), parameter);
  }

  return Array.from(parametersByKey.values());
}

function buildParameterSchema(
  parameters: readonly ResolvedParameter[],
  location: ResolvedParameter["in"],
): JsonSchemaObject | undefined {
  const parametersForLocation = parameters.filter((parameter) => parameter.in === location);
  if (parametersForLocation.length === 0) {
    return undefined;
  }

  const properties: Record<string, JsonSchemaObject> = {};
  const requiredProperties: string[] = [];

  for (const parameter of parametersForLocation) {
    const propertyName = location === "header" ? parameter.name.toLowerCase() : parameter.name;
    properties[propertyName] = parameter.schema;

    if (parameter.required === true) {
      requiredProperties.push(propertyName);
    }
  }

  const parameterSchema: JsonSchemaObject = {
    additionalProperties: location === "header",
    properties,
    type: "object",
  };

  if (requiredProperties.length > 0) {
    parameterSchema.required = requiredProperties.toSorted();
  }

  return parameterSchema;
}

function readJsonContentSchema(
  value: unknown,
  context: string,
  readJsonSchemaObject: ReadJsonSchemaObject,
): JsonSchemaObject {
  const content = readRecord(value, context);
  const contentTypes = Object.keys(content).toSorted();
  if (contentTypes.length !== 1 || contentTypes[0] !== "application/json") {
    throw new GeneratorError(
      `${context} supports only exactly one content type: application/json.`,
    );
  }

  const jsonMediaType = readRecord(content["application/json"], `${context}["application/json"]`);
  if (jsonMediaType["schema"] === undefined) {
    throw new GeneratorError(`${context}["application/json"].schema is required.`);
  }

  return readJsonSchemaObject(jsonMediaType["schema"], `${context}["application/json"].schema`);
}

function readRequestBody(
  operation: Record<string, unknown>,
  operationContext: string,
  readJsonSchemaObject: ReadJsonSchemaObject,
): { bodySchema: JsonSchemaObject | undefined; hasRequiredBody: boolean } {
  const requestBody = readOptionalRecord(
    operation["requestBody"],
    `${operationContext}.requestBody`,
  );
  if (requestBody === undefined) {
    return {
      bodySchema: undefined,
      hasRequiredBody: false,
    };
  }

  const content = requestBody["content"];
  if (content === undefined) {
    throw new GeneratorError(
      `${operationContext}.requestBody.content is required when requestBody is defined.`,
    );
  }

  return {
    bodySchema: readJsonContentSchema(
      content,
      `${operationContext}.requestBody.content`,
      readJsonSchemaObject,
    ),
    hasRequiredBody:
      readOptionalBoolean(requestBody["required"], `${operationContext}.requestBody.required`) !==
      false,
  };
}

function readResponseSchemas(
  operation: Record<string, unknown>,
  operationContext: string,
  readJsonSchemaObject: ReadJsonSchemaObject,
): OpenApiOperationResponse[] {
  const responses = readOptionalRecord(operation["responses"], `${operationContext}.responses`);
  if (responses === undefined) {
    throw new GeneratorError(`${operationContext}.responses must be defined.`);
  }

  const responseSchemas = Object.entries(responses)
    .filter(([, responseValue]) => responseValue !== undefined)
    .map(([statusCode, responseValue]) => {
      if (!/^[0-9]{3}$/.test(statusCode)) {
        throw new GeneratorError(
          `${operationContext}.responses has unsupported status key "${statusCode}". Use a three-digit HTTP status code.`,
        );
      }

      const response = readRecord(responseValue, `${operationContext}.responses["${statusCode}"]`);
      const content = readOptionalRecord(
        response["content"],
        `${operationContext}.responses["${statusCode}"].content`,
      );

      return {
        schema:
          content === undefined
            ? undefined
            : readJsonContentSchema(
                content,
                `${operationContext}.responses["${statusCode}"].content`,
                readJsonSchemaObject,
              ),
        statusCode,
      };
    });

  if (responseSchemas.length === 0) {
    throw new GeneratorError(`${operationContext}.responses must contain at least one response.`);
  }

  return responseSchemas.toSorted(
    (left, right) => Number(left.statusCode) - Number(right.statusCode),
  );
}

function readComponentSchemas(
  document: Record<string, unknown>,
  readJsonSchemaObject: ReadJsonSchemaObject,
): {
  componentZodSchemaVariableNamesByJsonSchema: Map<JsonSchemaObject, string>;
  componentSchemas: OpenApiComponentSchema[];
} {
  const componentZodSchemaVariableNamesByJsonSchema = new Map<JsonSchemaObject, string>();
  const componentSchemas: OpenApiComponentSchema[] = [];
  const componentNamesByVariableName = new Map<string, string>();

  const components = readOptionalRecord(document["components"], "components");
  const schemaValues = readOptionalRecord(components?.["schemas"], "components.schemas");
  if (schemaValues === undefined) {
    return {
      componentZodSchemaVariableNamesByJsonSchema,
      componentSchemas,
    };
  }

  for (const componentName of Object.keys(schemaValues).toSorted()) {
    const schema = readJsonSchemaObject(
      schemaValues[componentName],
      `components.schemas.${componentName}`,
    );
    const zodSchemaVariableName = toComponentSchemaVariableName(componentName);
    const existingComponentName = componentNamesByVariableName.get(zodSchemaVariableName);
    if (existingComponentName !== undefined) {
      throw new GeneratorError(
        `Component schemas "${existingComponentName}" and "${componentName}" collide on Zod schema variable name "${zodSchemaVariableName}".`,
      );
    }

    componentNamesByVariableName.set(zodSchemaVariableName, componentName);
    componentZodSchemaVariableNamesByJsonSchema.set(schema, zodSchemaVariableName);
    componentSchemas.push({
      componentName,
      schema,
      zodSchemaVariableName,
    });
  }

  return {
    componentZodSchemaVariableNamesByJsonSchema,
    componentSchemas,
  };
}

export function buildOpenApiRouteCatalog(document: Record<string, unknown>): OpenApiRouteCatalog {
  const readJsonSchemaObject = createJsonSchemaObjectReader();
  const { componentZodSchemaVariableNamesByJsonSchema, componentSchemas } = readComponentSchemas(
    document,
    readJsonSchemaObject,
  );

  const pathItems = readOptionalRecord(document["paths"], "paths");
  if (pathItems === undefined) {
    throw new GeneratorError("OpenAPI document must define a paths object.");
  }

  const operations: OpenApiOperation[] = [];
  const operationIds = new Set<string>();

  for (const openApiPath of Object.keys(pathItems).toSorted()) {
    const pathItem = readRecord(pathItems[openApiPath], `paths.${openApiPath}`);
    const pathParameters = readParameters(
      pathItem["parameters"],
      `paths.${openApiPath}.parameters`,
      readJsonSchemaObject,
    );

    for (const openApiMethod of supportedOpenApiMethods) {
      const operationValue = pathItem[openApiMethod];
      if (operationValue === undefined) {
        continue;
      }

      const operationContext = `paths.${openApiPath}.${openApiMethod}`;
      const operation = readRecord(operationValue, operationContext);
      const operationId = readOperationId(operation["operationId"], operationContext);
      if (operationIds.has(operationId)) {
        throw new GeneratorError(`Duplicate operationId "${operationId}" found.`);
      }

      operationIds.add(operationId);

      const operationParameters = readParameters(
        operation["parameters"],
        `${operationContext}.parameters`,
        readJsonSchemaObject,
      );
      const mergedParameters = mergeParameters(pathParameters, operationParameters);
      const { bodySchema, hasRequiredBody } = readRequestBody(
        operation,
        operationContext,
        readJsonSchemaObject,
      );

      operations.push({
        bodySchema,
        fastifyPath: toFastifyPath(openApiPath),
        hasRequiredBody,
        headersSchema: buildParameterSchema(mergedParameters, "header"),
        httpMethod: httpMethodNames[openApiMethod],
        operationId,
        paramsSchema: buildParameterSchema(mergedParameters, "path"),
        querystringSchema: buildParameterSchema(mergedParameters, "query"),
        responseSchemas: readResponseSchemas(operation, operationContext, readJsonSchemaObject),
      });
    }
  }

  if (operations.length === 0) {
    throw new GeneratorError("OpenAPI document does not define any operations.");
  }

  return {
    componentZodSchemaVariableNamesByJsonSchema,
    componentSchemas,
    operations,
  };
}
