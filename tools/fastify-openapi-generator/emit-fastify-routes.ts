import { generatedHeader, getOperationFilePath } from "./emit-shared.ts";
import type { GeneratedFile, OpenApiRouteCatalog } from "./types.ts";

export function emitFastifyRoutesFile(openApiRouteCatalog: OpenApiRouteCatalog): GeneratedFile {
  const lines: string[] = [generatedHeader, ""];

  for (const operation of openApiRouteCatalog.operations) {
    lines.push(
      `import { ${operation.operationId}FastifyRouteDefinition } from ${JSON.stringify(`./${getOperationFilePath(operation)}`)};`,
    );
  }

  lines.push("");
  lines.push("export const fastifyRouteDefinitionsByOperationId = {");
  for (const operation of openApiRouteCatalog.operations) {
    lines.push(`  ${operation.operationId}: ${operation.operationId}FastifyRouteDefinition,`);
  }
  lines.push("} as const;");
  lines.push("");

  return {
    content: `${lines.join("\n").trimEnd()}\n`,
    relativePath: "route-definitions.ts",
  };
}
