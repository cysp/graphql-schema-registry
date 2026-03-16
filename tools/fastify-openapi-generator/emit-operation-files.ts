import {
  createGeneratedFile,
  generatedHeader,
  getOperationFilePath,
  operationSections,
  renderJsonSchemaLiteral,
} from "./emit-shared.ts";
import type { GeneratedFile, JsonSchema, NormalizedOperation } from "./types.ts";

function renderSchemaPropertyLines(
  propertyName: string,
  schema: JsonSchema,
  indentation: number,
): string[] {
  const renderedSchemaLines = renderJsonSchemaLiteral(schema).split("\n");
  const propertyPrefix = `${" ".repeat(indentation)}${propertyName}: `;
  const [firstLine, ...remainingLines] = renderedSchemaLines;
  const lines = [
    `${propertyPrefix}${firstLine}`,
    ...remainingLines.map((line) => `${" ".repeat(indentation)}${line}`),
  ];

  return lines.map((line, index) => (index === lines.length - 1 ? `${line},` : line));
}

function renderOperationRouteDefinitionSection(operation: NormalizedOperation): string[] {
  const lines = [
    'import type { FastifyRouteDefinition } from "../../route-types.ts";',
    "",
    `export const ${operation.operationId}RouteDefinition = {`,
    `  method: ${JSON.stringify(operation.method)},`,
    `  url: ${JSON.stringify(operation.url)},`,
    "  schema: {",
  ];

  for (const section of operationSections) {
    if (operation.schema[section] === undefined) {
      continue;
    }

    lines.push(...renderSchemaPropertyLines(section, operation.schema[section], 4));
  }

  lines.push("    response: {");
  for (const [statusCode, schema] of Object.entries(operation.schema.response)) {
    lines.push(...renderSchemaPropertyLines(statusCode, schema ?? {}, 6));
  }
  lines.push("    },");
  lines.push("  },");
  lines.push("} as const satisfies FastifyRouteDefinition;");

  return lines;
}

export function emitOperationFile(operation: NormalizedOperation): GeneratedFile {
  return createGeneratedFile(getOperationFilePath(operation), [
    [generatedHeader],
    renderOperationRouteDefinitionSection(operation),
  ]);
}
