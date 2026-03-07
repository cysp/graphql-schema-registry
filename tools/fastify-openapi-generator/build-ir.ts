// oxlint-disable eslint/max-lines

import { GeneratorError } from "./errors.ts";
import { isValidIdentifier, toFastifyPath } from "./naming.ts";
import type { JsonSchema, NormalizedOperation, NormalizedRouteSchema } from "./types.ts";
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
  schema: JsonSchema;
};

const httpMethodNames: Record<SupportedOpenApiMethod, NormalizedOperation["method"]> = {
  delete: "DELETE",
  get: "GET",
  post: "POST",
  put: "PUT",
};

function readOperationId(value: unknown, operationContext: string): string | undefined {
  const operationId = readOptionalString(value, `${operationContext}.operationId`)?.trim();
  if (!operationId) {
    return undefined;
  }

  if (!isValidIdentifier(operationId)) {
    throw new GeneratorError(
      `${operationContext}.operationId "${operationId}" must be a valid TypeScript identifier.`,
    );
  }

  return operationId;
}

function readJsonSchema(value: unknown, context: string): JsonSchema {
  return readRecord(value, context) as JsonSchema;
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

function readParameters(value: unknown, context: string): ResolvedParameter[] {
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
      schema: readJsonSchema(parameter["schema"], `${parameterContext}.schema`),
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

function readPathTemplateParameterNames(openApiPath: string): string[] {
  const parameterNames: string[] = [];

  for (const match of openApiPath.matchAll(/\{([^}]+)\}/g)) {
    const parameterName = match[1];
    if (parameterName !== undefined) {
      parameterNames.push(parameterName);
    }
  }

  return parameterNames;
}

function assertPathTemplateParametersMatch(
  openApiPath: string,
  parameters: readonly ResolvedParameter[],
  operationContext: string,
): void {
  const templateParameterNames = readPathTemplateParameterNames(openApiPath);
  const templateParameterNameSet = new Set(templateParameterNames);
  const declaredPathParameterNames = parameters
    .filter((parameter) => parameter.in === "path")
    .map((parameter) => parameter.name);
  const declaredPathParameterNameSet = new Set(declaredPathParameterNames);
  const missingDeclaredPathParameters = templateParameterNames
    .filter((parameterName) => !declaredPathParameterNameSet.has(parameterName))
    .toSorted();
  const unusedDeclaredPathParameters = declaredPathParameterNames
    .filter((parameterName) => !templateParameterNameSet.has(parameterName))
    .toSorted();

  if (missingDeclaredPathParameters.length === 0 && unusedDeclaredPathParameters.length === 0) {
    return;
  }

  const validationMessages: string[] = [];
  if (missingDeclaredPathParameters.length > 0) {
    validationMessages.push(
      `missing path parameter declarations for: ${missingDeclaredPathParameters.join(", ")}`,
    );
  }
  if (unusedDeclaredPathParameters.length > 0) {
    validationMessages.push(
      `declared path parameters not present in template: ${unusedDeclaredPathParameters.join(", ")}`,
    );
  }

  throw new GeneratorError(
    `${operationContext} path template parameters must match declared path parameters; ${validationMessages.join("; ")}.`,
  );
}

function buildParameterSchema(
  parameters: readonly ResolvedParameter[],
  location: ResolvedParameter["in"],
): JsonSchema | undefined {
  const parametersForLocation = parameters.filter((parameter) => parameter.in === location);
  if (parametersForLocation.length === 0) {
    return undefined;
  }

  const properties: Record<string, JsonSchema> = {};
  const requiredProperties: string[] = [];

  for (const parameter of parametersForLocation) {
    const propertyName = location === "header" ? parameter.name.toLowerCase() : parameter.name;
    properties[propertyName] = parameter.schema;

    if (parameter.required === true) {
      requiredProperties.push(propertyName);
    }
  }

  if (requiredProperties.length === 0) {
    return {
      additionalProperties: location === "header",
      properties,
      type: "object",
    };
  }

  return {
    additionalProperties: location === "header",
    properties,
    required: requiredProperties.toSorted(),
    type: "object",
  };
}

function readJsonContentSchema(value: unknown, context: string): JsonSchema {
  const content = readRecord(value, context);
  const contentTypes = Object.keys(content).toSorted();
  const preferredJsonContentType = contentTypes.includes("application/json")
    ? "application/json"
    : undefined;
  const fallbackJsonContentTypes = contentTypes.filter((contentType) =>
    contentType.endsWith("+json"),
  );
  const jsonContentType =
    preferredJsonContentType ??
    (fallbackJsonContentTypes.length === 1 ? fallbackJsonContentTypes[0] : undefined);
  if (jsonContentType === undefined) {
    throw new GeneratorError(
      `${context} must include exactly one supported JSON content type (application/json or a single application/*+json variant).`,
    );
  }

  const jsonMediaType = readRecord(
    content[jsonContentType],
    `${context}[${JSON.stringify(jsonContentType)}]`,
  );
  if (jsonMediaType["schema"] === undefined) {
    throw new GeneratorError(`${context}[${JSON.stringify(jsonContentType)}].schema is required.`);
  }

  return readJsonSchema(
    jsonMediaType["schema"],
    `${context}[${JSON.stringify(jsonContentType)}].schema`,
  );
}

function readRequestBody(
  operation: Record<string, unknown>,
  operationContext: string,
): JsonSchema | undefined {
  const requestBody = readOptionalRecord(
    operation["requestBody"],
    `${operationContext}.requestBody`,
  );
  if (requestBody === undefined) {
    return undefined;
  }

  const content = requestBody["content"];
  if (content === undefined) {
    throw new GeneratorError(
      `${operationContext}.requestBody.content is required when requestBody is defined.`,
    );
  }

  const requestBodySchema = readJsonContentSchema(
    content,
    `${operationContext}.requestBody.content`,
  );
  const isRequired = readOptionalBoolean(
    requestBody["required"],
    `${operationContext}.requestBody.required`,
  );
  if (isRequired !== true) {
    throw new GeneratorError(
      `${operationContext}.requestBody must set required: true when a request body is defined.`,
    );
  }

  return requestBodySchema;
}

function readResponseSchemas(
  operation: Record<string, unknown>,
  operationContext: string,
): NormalizedRouteSchema["response"] {
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
              ),
        statusCode,
      };
    })
    .toSorted((left, right) => Number(left.statusCode) - Number(right.statusCode));

  if (responseSchemas.length === 0) {
    throw new GeneratorError(`${operationContext}.responses must contain at least one response.`);
  }

  return Object.fromEntries(
    responseSchemas.map((responseSchema) => [responseSchema.statusCode, responseSchema.schema]),
  );
}

function buildOperationSchema(
  parameters: readonly ResolvedParameter[],
  operation: Record<string, unknown>,
  operationContext: string,
): NormalizedRouteSchema {
  const schema: NormalizedRouteSchema = {
    response: readResponseSchemas(operation, operationContext),
  };
  const headersSchema = buildParameterSchema(parameters, "header");
  const paramsSchema = buildParameterSchema(parameters, "path");
  const querystringSchema = buildParameterSchema(parameters, "query");
  const bodySchema = readRequestBody(operation, operationContext);

  if (bodySchema !== undefined) {
    schema.body = bodySchema;
  }
  if (headersSchema !== undefined) {
    schema.headers = headersSchema;
  }
  if (paramsSchema !== undefined) {
    schema.params = paramsSchema;
  }
  if (querystringSchema !== undefined) {
    schema.querystring = querystringSchema;
  }

  return schema;
}

function readNamedOperation(
  openApiPath: string,
  openApiMethod: SupportedOpenApiMethod,
  pathParameters: readonly ResolvedParameter[],
  operationValue: unknown,
  operationIds: Set<string>,
): NormalizedOperation | undefined {
  if (operationValue === undefined) {
    return undefined;
  }

  const operationContext = `paths.${openApiPath}.${openApiMethod}`;
  const operation = readRecord(operationValue, operationContext);
  const operationId = readOperationId(operation["operationId"], operationContext);
  if (operationId === undefined) {
    return undefined;
  }

  if (operationIds.has(operationId)) {
    throw new GeneratorError(`Duplicate operationId "${operationId}" found.`);
  }

  operationIds.add(operationId);

  const operationParameters = readParameters(
    operation["parameters"],
    `${operationContext}.parameters`,
  );
  const mergedParameters = mergeParameters(pathParameters, operationParameters);
  assertPathTemplateParametersMatch(openApiPath, mergedParameters, operationContext);

  return {
    method: httpMethodNames[openApiMethod],
    operationId,
    schema: buildOperationSchema(mergedParameters, operation, operationContext),
    url: toFastifyPath(openApiPath),
  };
}

export function buildOpenApiOperations(document: Record<string, unknown>): NormalizedOperation[] {
  const pathItems = readOptionalRecord(document["paths"], "paths");
  if (pathItems === undefined) {
    throw new GeneratorError("OpenAPI document must define a paths object.");
  }

  const operations: NormalizedOperation[] = [];
  const operationIds = new Set<string>();

  for (const openApiPath of Object.keys(pathItems).toSorted()) {
    const pathItem = readRecord(pathItems[openApiPath], `paths.${openApiPath}`);
    const pathParameters = readParameters(
      pathItem["parameters"],
      `paths.${openApiPath}.parameters`,
    );

    for (const openApiMethod of supportedOpenApiMethods) {
      const namedOperation = readNamedOperation(
        openApiPath,
        openApiMethod,
        pathParameters,
        pathItem[openApiMethod],
        operationIds,
      );
      if (namedOperation === undefined) {
        continue;
      }

      operations.push(namedOperation);
    }
  }

  return operations;
}
