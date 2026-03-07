import { createGeneratedFile, generatedHeader } from "./emit-shared.ts";
import type { GeneratedFile, NormalizedOperation } from "./types.ts";

function renderOpenApiOperationHandlersSection(): string[] {
  return [
    "export type OpenApiOperationHandlers = {",
    "  [OperationId in keyof typeof operationRouteDefinitions]: FastifyRouteHandlerFromDefinition<",
    "    (typeof operationRouteDefinitions)[OperationId]",
    "  >;",
    "};",
  ];
}

function renderRegisterOpenApiRoutesSection(operations: readonly NormalizedOperation[]): string[] {
  const lines = [
    "export function registerOpenApiRoutes(",
    "  server: FastifyJsonSchemaToTsInstance,",
    "  operationHandlers: OpenApiOperationHandlers,",
    "): void {",
  ];

  if (operations.length === 0) {
    lines.push("  void server;");
    lines.push("  void operationHandlers;");
    lines.push("}");
    return lines;
  }

  for (const [index, operation] of operations.entries()) {
    if (index > 0) {
      lines.push("");
    }
    lines.push("  server.route({");
    lines.push(`    ...operationRouteDefinitions[${JSON.stringify(operation.operationId)}],`);
    lines.push(`    handler: operationHandlers[${JSON.stringify(operation.operationId)}],`);
    lines.push("  });");
  }
  lines.push("}");

  return lines;
}

export function emitRoutesFile(operations: readonly NormalizedOperation[]): GeneratedFile {
  const importLines = [
    'import type { FastifyJsonSchemaToTsInstance, FastifyRouteHandlerFromDefinition } from "../route-types.ts";',
    'import { operationRouteDefinitions } from "./operations/index.ts";',
  ];

  const sections = [
    [generatedHeader],
    importLines,
    renderOpenApiOperationHandlersSection(),
    renderRegisterOpenApiRoutesSection(operations),
  ];

  return createGeneratedFile("routes.ts", sections);
}
