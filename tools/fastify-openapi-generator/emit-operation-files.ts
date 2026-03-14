import {
  buildValueImportLinesByPath,
  generatedHeader,
  getOperationFilePath,
  getOperationJsonSchemaConstName,
  getOperationResponseJsonSchemaConstName,
  getOperationSectionSchemaName,
  operationSections,
  pushJsonSchemaConst,
  renderEmittedZodSchema,
  type EmittedOperationResponseSchema,
  type EmittedOperationSectionSchema,
  type ImportedComponentSchema,
  type OperationSection,
} from "./emit-shared.ts";
import type {
  GeneratedFile,
  OpenApiOperation,
  OpenApiRouteCatalog,
  JsonSchemaObject,
} from "./types.ts";

function isSuccessStatusCode(statusCode: string): boolean {
  return statusCode.startsWith("2");
}

function renderOperationResponses(
  operation: OpenApiOperation,
  openApiRouteCatalog: OpenApiRouteCatalog,
  importedComponentSchemas: ImportedComponentSchema[],
): EmittedOperationResponseSchema[] {
  return operation.responseSchemas.map((responseSchema) => {
    if (responseSchema.schema === undefined) {
      return {
        schemaExpression: isSuccessStatusCode(responseSchema.statusCode)
          ? "z.void()"
          : "z.unknown()",
        statusCode: responseSchema.statusCode,
      };
    }

    const schema = renderEmittedZodSchema(
      responseSchema.schema,
      getOperationResponseJsonSchemaConstName(operation, responseSchema.statusCode),
      openApiRouteCatalog,
      importedComponentSchemas,
    );

    return {
      schema,
      schemaExpression: schema.schemaExpression,
      statusCode: responseSchema.statusCode,
    };
  });
}

function buildOperationSection(
  operation: OpenApiOperation,
  section: OperationSection,
  schema: JsonSchemaObject | undefined,
  openApiRouteCatalog: OpenApiRouteCatalog,
  importedComponentSchemas: ImportedComponentSchema[],
): EmittedOperationSectionSchema | undefined {
  if (schema === undefined) {
    return undefined;
  }

  const emittedSchema = renderEmittedZodSchema(
    schema,
    getOperationJsonSchemaConstName(operation, section),
    openApiRouteCatalog,
    importedComponentSchemas,
  );
  const schemaExpression =
    section === "body" && !operation.hasRequiredBody
      ? `${emittedSchema.schemaExpression}.optional()`
      : emittedSchema.schemaExpression;

  return {
    schema: emittedSchema,
    schemaExpression,
    schemaName: getOperationSectionSchemaName(operation, section),
    section,
  };
}

function buildOperationSections(
  operation: OpenApiOperation,
  openApiRouteCatalog: OpenApiRouteCatalog,
  importedComponentSchemas: ImportedComponentSchema[],
): EmittedOperationSectionSchema[] {
  const schemasBySection: Record<OperationSection, JsonSchemaObject | undefined> = {
    body: operation.bodySchema,
    headers: operation.headersSchema,
    params: operation.paramsSchema,
    querystring: operation.querystringSchema,
  };

  return operationSections
    .map((section) =>
      buildOperationSection(
        operation,
        section,
        schemasBySection[section],
        openApiRouteCatalog,
        importedComponentSchemas,
      ),
    )
    .filter((operationSection) => operationSection !== undefined);
}

function pushOperationSection(
  lines: string[],
  operationSection: EmittedOperationSectionSchema,
): void {
  pushJsonSchemaConst(
    lines,
    operationSection.schema.jsonSchemaConstName,
    operationSection.schema.jsonSchemaLiteral,
  );

  lines.push(`export const ${operationSection.schemaName} = ${operationSection.schemaExpression};`);
  lines.push("");
}

function pushOperationResponseJsonSchemaConsts(
  lines: string[],
  emittedResponses: readonly EmittedOperationResponseSchema[],
): void {
  for (const emittedResponse of emittedResponses) {
    pushJsonSchemaConst(
      lines,
      emittedResponse.schema?.jsonSchemaConstName,
      emittedResponse.schema?.jsonSchemaLiteral,
    );
  }
}

function pushOperationRouteSchema(
  lines: string[],
  operation: OpenApiOperation,
  operationSections: readonly EmittedOperationSectionSchema[],
  emittedResponses: readonly EmittedOperationResponseSchema[],
): void {
  lines.push(`export const ${operation.operationId}RouteSchema = {`);
  for (const operationSection of operationSections) {
    lines.push(`  ${operationSection.section}: ${operationSection.schemaName},`);
  }
  lines.push("  response: {");
  for (const emittedResponse of emittedResponses) {
    lines.push(`    ${emittedResponse.statusCode}: ${emittedResponse.schemaExpression},`);
  }
  lines.push("  },");
  lines.push("} as const;");
  lines.push("");
}

function pushOperationFastifyRouteDefinition(lines: string[], operation: OpenApiOperation): void {
  lines.push(`export const ${operation.operationId}FastifyRouteDefinition = {`);
  lines.push(`  method: ${JSON.stringify(operation.httpMethod)},`);
  lines.push(`  url: ${JSON.stringify(operation.fastifyPath)},`);
  lines.push(`  schema: ${operation.operationId}RouteSchema,`);
  lines.push("} as const;");
  lines.push("");
}

export function emitOperationFile(
  operation: OpenApiOperation,
  openApiRouteCatalog: OpenApiRouteCatalog,
): GeneratedFile {
  const importedComponentSchemas: ImportedComponentSchema[] = [];
  const operationSections = buildOperationSections(
    operation,
    openApiRouteCatalog,
    importedComponentSchemas,
  );
  const emittedResponses = renderOperationResponses(
    operation,
    openApiRouteCatalog,
    importedComponentSchemas,
  );
  const usesZodFromJsonSchemaTyped =
    operationSections.some(
      (operationSection) => operationSection.schema.jsonSchemaConstName !== undefined,
    ) ||
    emittedResponses.some(
      (emittedResponse) => emittedResponse.schema?.jsonSchemaConstName !== undefined,
    );

  const lines: string[] = [generatedHeader, "", 'import { z } from "zod";'];

  if (usesZodFromJsonSchemaTyped) {
    lines.push('import { zodFromJsonSchemaTyped } from "../../zod-from-json-schema-typed.ts";');
  }

  const componentImportsByPath = new Map<string, Set<string>>();
  for (const importedComponentSchema of importedComponentSchemas) {
    const componentImportPath = `../${importedComponentSchema.componentFilePath}`;
    const componentImports = componentImportsByPath.get(componentImportPath) ?? new Set<string>();
    componentImports.add(importedComponentSchema.zodSchemaVariableName);
    componentImportsByPath.set(componentImportPath, componentImports);
  }
  for (const componentImportLine of buildValueImportLinesByPath(componentImportsByPath)) {
    lines.push(componentImportLine);
  }
  lines.push("");

  for (const operationSection of operationSections) {
    pushOperationSection(lines, operationSection);
  }

  pushOperationResponseJsonSchemaConsts(lines, emittedResponses);
  pushOperationRouteSchema(lines, operation, operationSections, emittedResponses);
  pushOperationFastifyRouteDefinition(lines, operation);

  return {
    content: `${lines.join("\n").trimEnd()}\n`,
    relativePath: getOperationFilePath(operation),
  };
}
