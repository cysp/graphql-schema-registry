import { readFile } from "node:fs/promises";
import path from "node:path";

import JsonSchemaRefParser from "@apidevtools/json-schema-ref-parser";
import YAML from "yaml";

import { GeneratorError } from "./errors.ts";
import { readNonEmptyString, readRecord } from "./value-readers.ts";

export async function loadOpenApiDocument(documentPath: string): Promise<Record<string, unknown>> {
  const resolvedDocumentPath = path.resolve(documentPath);
  const source = await readFile(resolvedDocumentPath, "utf8");
  const parsedDocument = readRecord(
    YAML.parse(source),
    `OpenAPI document "${resolvedDocumentPath}"`,
  );

  const refParser = new JsonSchemaRefParser();
  const dereferencedValue: unknown = await refParser.dereference(
    resolvedDocumentPath,
    parsedDocument,
    {
      dereference: {
        circular: false,
      },
    },
  );
  const dereferencedDocument = readRecord(
    dereferencedValue,
    `OpenAPI document "${resolvedDocumentPath}"`,
  );

  const openApiVersion = readNonEmptyString(
    dereferencedDocument["openapi"],
    `OpenAPI document "${resolvedDocumentPath}".openapi`,
  );

  if (!openApiVersion.startsWith("3.")) {
    throw new GeneratorError(
      `Only OpenAPI 3.x documents are supported. Received "${openApiVersion}".`,
    );
  }

  return dereferencedDocument;
}
