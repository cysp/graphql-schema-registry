import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildOpenApiOperations } from "./fastify-openapi-generator/build-ir.ts";
import { emitGeneratedOpenApiFiles } from "./fastify-openapi-generator/emit-files.ts";
import { loadOpenApiDocument } from "./fastify-openapi-generator/load-spec.ts";
import { writeGeneratedFiles } from "./fastify-openapi-generator/write-files.ts";

async function main(): Promise<void> {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const openApiDocumentPath = path.resolve(repositoryRoot, "openapi/openapi.yaml");
  const generatedOutputDirectory = path.resolve(
    repositoryRoot,
    "src/lib/fastify/openapi/generated",
  );

  const openApiDocument = await loadOpenApiDocument(openApiDocumentPath);
  const operations = buildOpenApiOperations(openApiDocument);
  const generatedFiles = emitGeneratedOpenApiFiles(operations);

  await writeGeneratedFiles(generatedOutputDirectory, generatedFiles);
}

await main();
