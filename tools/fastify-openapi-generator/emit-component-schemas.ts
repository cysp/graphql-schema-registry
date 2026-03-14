import {
  generatedHeader,
  getComponentFilePath,
  renderInlineJsonSchemaLiteral,
} from "./emit-shared.ts";
import type { GeneratedFile, OpenApiRouteCatalog, JsonSchemaObject } from "./types.ts";

export function emitComponentSchemaFiles(
  openApiRouteCatalog: OpenApiRouteCatalog,
  componentJsonSchemaConstNamesByJsonSchema: Map<JsonSchemaObject, string>,
): GeneratedFile[] {
  return openApiRouteCatalog.componentSchemas.map((componentSchema) => {
    const componentJsonSchemaConstName = componentJsonSchemaConstNamesByJsonSchema.get(
      componentSchema.schema,
    );
    if (componentJsonSchemaConstName === undefined) {
      throw new Error(
        `Missing component JSON schema const name for ${componentSchema.componentName}.`,
      );
    }

    const lines: string[] = [
      generatedHeader,
      "",
      'import { zodFromJsonSchemaTyped } from "../../zod-from-json-schema-typed.ts";',
      "",
      `export const ${componentJsonSchemaConstName} = ${renderInlineJsonSchemaLiteral(componentSchema.schema)} as const;`,
      "",
      `export const ${componentSchema.zodSchemaVariableName} = zodFromJsonSchemaTyped(${componentJsonSchemaConstName});`,
      "",
    ];

    return {
      content: `${lines.join("\n").trimEnd()}\n`,
      relativePath: getComponentFilePath(componentSchema),
    };
  });
}
