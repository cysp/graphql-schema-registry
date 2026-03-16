import { createGeneratedFile, generatedHeader, getOperationFilePath } from "./emit-shared.ts";
import type { GeneratedFile, NormalizedOperation } from "./types.ts";

function renderOperationImports(operations: readonly NormalizedOperation[]): string[] {
  return operations.map(
    (operation) =>
      `import { ${operation.operationId}RouteDefinition } from ${JSON.stringify(`./${getOperationFilePath(operation).replace("operations/", "")}`)};`,
  );
}

function renderOperationCatalog(operations: readonly NormalizedOperation[]): string[] {
  if (operations.length === 0) {
    return ["export const operationRouteDefinitions = {};"];
  }

  const lines = ["export const operationRouteDefinitions = {"];

  for (const operation of operations) {
    lines.push(
      `  [${JSON.stringify(operation.operationId)}]: ${operation.operationId}RouteDefinition,`,
    );
  }

  lines.push("};");

  return lines;
}

export function emitOperationIndexFile(operations: readonly NormalizedOperation[]): GeneratedFile {
  const sections = [[generatedHeader]];

  const importLines = renderOperationImports(operations);
  if (importLines.length > 0) {
    sections.push(importLines);
  }
  sections.push(renderOperationCatalog(operations));

  return createGeneratedFile("operations/index.ts", sections);
}
