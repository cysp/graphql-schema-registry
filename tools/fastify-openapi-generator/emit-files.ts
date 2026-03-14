import { emitComponentSchemaFiles } from "./emit-component-schemas.ts";
import { emitFastifyRoutesFile } from "./emit-fastify-routes.ts";
import { emitOperationFile } from "./emit-operation-files.ts";
import { buildComponentJsonSchemaConstNamesByJsonSchema } from "./emit-shared.ts";
import type { GeneratedFile, OpenApiRouteCatalog } from "./types.ts";

export function emitGeneratedOpenApiFiles(
  openApiRouteCatalog: OpenApiRouteCatalog,
): GeneratedFile[] {
  const componentJsonSchemaConstNamesByJsonSchema =
    buildComponentJsonSchemaConstNamesByJsonSchema(openApiRouteCatalog);
  const operationFiles = openApiRouteCatalog.operations.map((operation) =>
    emitOperationFile(operation, openApiRouteCatalog),
  );
  const componentFiles = emitComponentSchemaFiles(
    openApiRouteCatalog,
    componentJsonSchemaConstNamesByJsonSchema,
  );

  return [...componentFiles, ...operationFiles, emitFastifyRoutesFile(openApiRouteCatalog)];
}
