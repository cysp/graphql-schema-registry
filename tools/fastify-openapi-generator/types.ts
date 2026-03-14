export type JsonSchemaObject = {
  $ref?: string;
  additionalProperties?: boolean;
  description?: string;
  format?: string;
  items?: JsonSchemaObject;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  type?: "array" | "object" | "string";
};

export type OpenApiOperationResponse = {
  schema: JsonSchemaObject | undefined;
  statusCode: string;
};

export type OpenApiOperation = {
  bodySchema: JsonSchemaObject | undefined;
  fastifyPath: string;
  hasRequiredBody: boolean;
  headersSchema: JsonSchemaObject | undefined;
  httpMethod: "DELETE" | "GET" | "POST" | "PUT";
  operationId: string;
  paramsSchema: JsonSchemaObject | undefined;
  querystringSchema: JsonSchemaObject | undefined;
  responseSchemas: OpenApiOperationResponse[];
};

export type OpenApiComponentSchema = {
  componentName: string;
  schema: JsonSchemaObject;
  zodSchemaVariableName: string;
};

export type OpenApiRouteCatalog = {
  componentZodSchemaVariableNamesByJsonSchema: Map<JsonSchemaObject, string>;
  componentSchemas: OpenApiComponentSchema[];
  operations: OpenApiOperation[];
};

export type GeneratedFile = {
  content: string;
  relativePath: string;
};
