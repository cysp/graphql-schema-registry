import path from "node:path";

import { buildOpenApiRouteCatalog } from "./fastify-openapi-generator/build-ir.ts";
import { emitGeneratedOpenApiFiles } from "./fastify-openapi-generator/emit-files.ts";
import { loadOpenApiDocument } from "./fastify-openapi-generator/load-spec.ts";
import { writeGeneratedFiles } from "./fastify-openapi-generator/write-files.ts";

async function main(): Promise<void> {
  const repositoryRoot = process.cwd();
  const openApiDocumentPath = path.resolve(repositoryRoot, "openapi/openapi.yaml");
  const generatedOutputDirectory = path.resolve(
    repositoryRoot,
    "src/lib/fastify/openapi/generated",
  );

  const openApiDocument = await loadOpenApiDocument(openApiDocumentPath);
  const openApiRouteCatalog = buildOpenApiRouteCatalog(openApiDocument);
  const generatedFiles = emitGeneratedOpenApiFiles(openApiRouteCatalog);

  await writeGeneratedFiles(generatedOutputDirectory, generatedFiles);
}

await main();
