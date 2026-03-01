import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { IR } from "@hey-api/openapi-ts";
import { collectResponseInfos } from "./responses.js";
import type { ResponseInfo } from "./responses.js";
import { fastifyPluginTypesTemplate } from "./templates.js";

type OperationInfo = {
  hasBody: boolean;
  hasHeaders: boolean;
  hasPath: boolean;
  hasQuery: boolean;
  id: string;
  method: string;
  path: string;
  responses: ResponseInfo[];
};

type PluginInstance = {
  context: {
    config: {
      output: {
        path: string;
      };
    };
    spec: unknown;
  };
  forEach: (
    ...args: [
      "operation",
      callback: (event: { operation: IR.OperationObject; type: "operation" }) => void,
      options?: { order?: "declarations" | "natural" | undefined },
    ]
  ) => void;
};

type OpenApiTsPlugin = {
  config: {
    includeInEntry: boolean;
  };
  dependencies: readonly string[];
  handler: (args: { plugin: PluginInstance }) => void;
  name: string;
};

function toPascalCase(value: string): string {
  return value
    .replaceAll(/[^A-Za-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function toFastifyPath(path: string): string {
  return path.replaceAll(/\{([^}]+)\}/g, ":$1");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function getResponseSchemaRefFromSpecResponse(specResponse: unknown): string | undefined {
  if (!isRecord(specResponse)) {
    return undefined;
  }
  if (typeof specResponse["$ref"] === "string") {
    return specResponse["$ref"];
  }
  if (!isRecord(specResponse["content"])) {
    return undefined;
  }
  for (const mediaType of Object.values(specResponse["content"])) {
    if (!isRecord(mediaType) || !isRecord(mediaType["schema"])) {
      continue;
    }
    if (typeof mediaType["schema"]["$ref"] === "string") {
      return mediaType["schema"]["$ref"];
    }
  }
  return undefined;
}

function getResponseSchemaRefsByStatus(
  spec: unknown,
  operation: IR.OperationObject,
): Record<string, string | undefined> {
  if (!isRecord(spec) || !isRecord(spec["paths"])) {
    return {};
  }
  const pathItem = spec["paths"][operation.path];
  if (!isRecord(pathItem)) {
    return {};
  }

  const operationInSpec = pathItem[operation.method];
  if (!isRecord(operationInSpec) || !isRecord(operationInSpec["responses"])) {
    return {};
  }

  const responseSchemaRefsByStatus: Record<string, string | undefined> = {};
  for (const [status, response] of Object.entries(operationInSpec["responses"])) {
    responseSchemaRefsByStatus[status] = getResponseSchemaRefFromSpecResponse(response);
  }

  return responseSchemaRefsByStatus;
}

function collectOperationInfo(
  operation: IR.OperationObject,
  responseSchemaRefsByStatus: Readonly<Record<string, string | undefined>>,
): OperationInfo {
  return {
    hasBody: Boolean(operation.body),
    hasHeaders: Boolean(
      operation.parameters?.header && Object.keys(operation.parameters.header).length > 0,
    ),
    hasPath: Boolean(
      operation.parameters?.path && Object.keys(operation.parameters.path).length > 0,
    ),
    hasQuery: Boolean(
      operation.parameters?.query && Object.keys(operation.parameters.query).length > 0,
    ),
    id: operation.id,
    method: operation.method.toLowerCase(),
    path: toFastifyPath(operation.path),
    responses: collectResponseInfos(operation, responseSchemaRefsByStatus),
  };
}

function generateImports(operations: readonly OperationInfo[]): string {
  const zodSymbols = new Set<string>();

  for (const operation of operations) {
    const name = toPascalCase(operation.id);
    const dataSymbol = `z${name}Data`;

    if (operation.hasBody || operation.hasHeaders || operation.hasPath || operation.hasQuery) {
      zodSymbols.add(dataSymbol);
    }

    for (const response of operation.responses) {
      zodSymbols.add(response.schemaSymbol);
    }
  }

  const sortedSymbols = Array.from(zodSymbols).toSorted();
  if (sortedSymbols.length === 0) {
    return [
      'import fastifyPlugin from "fastify-plugin";',
      'import type { FastifyPluginAsync, RouteShorthandOptionsWithHandler } from "fastify";',
      'import type { RouteHandlers } from "./fastify.gen.ts";',
    ].join("\n");
  }

  return [
    'import fastifyPlugin from "fastify-plugin";',
    'import type { FastifyPluginAsync, RouteShorthandOptionsWithHandler } from "fastify";',
    'import type { RouteHandlers } from "./fastify.gen.ts";',
    `import { ${sortedSymbols.join(", ")} } from "./zod.gen.ts";`,
  ].join("\n");
}

function generateRoutePaths(operations: readonly OperationInfo[]): string {
  const entries = operations.map((operation) => `  "${operation.id}": "${operation.path}",`);
  return ["export const routePaths = {", ...entries, "} as const;"].join("\n");
}

function generateOperationSchema(operation: OperationInfo): string {
  const lines: string[] = [];
  const operationName = toPascalCase(operation.id);
  const dataSymbol = `z${operationName}Data`;

  if (operation.hasPath) {
    lines.push(`    params: ${dataSymbol}.shape.path,`);
  }

  if (operation.hasQuery) {
    lines.push(`    querystring: ${dataSymbol}.shape.query,`);
  }

  if (operation.hasHeaders) {
    lines.push(`    headers: ${dataSymbol}.shape.headers,`);
  }

  if (operation.hasBody) {
    lines.push(`    body: ${dataSymbol}.shape.body,`);
  }

  if (operation.responses.length > 0) {
    const responses = operation.responses
      .map((response) => `"${response.status}": ${response.schemaSymbol}`)
      .join(", ");
    lines.push(`    response: { ${responses} },`);
  } else {
    lines.push("    response: {},");
  }

  return [`  "${operation.id}": {`, ...lines, "  },"].join("\n");
}

function generateRouteSchemas(operations: readonly OperationInfo[]): string {
  return [
    "export const routeSchemas = {",
    ...operations.map((operation) => generateOperationSchema(operation)),
    "} as const;",
  ].join("\n");
}

function generateFastifyPlugin(operations: readonly OperationInfo[]): string {
  const statements = operations.map(
    (operation) =>
      `  server.${operation.method}(routePaths["${operation.id}"], { ...normalizeRouteEntry(routes["${operation.id}"]), schema: routeSchemas["${operation.id}"] });`,
  );

  return [
    "const fastifyRoutesPluginImpl: FastifyPluginAsync<FastifyRoutesPluginOptions> = async (",
    "  server,",
    "  options,",
    "): Promise<void> => {",
    "  const routes = options.routes;",
    "",
    ...statements,
    "};",
    "",
    "export const fastifyRoutesPlugin = fastifyPlugin<FastifyRoutesPluginOptions>(",
    "  fastifyRoutesPluginImpl,",
    "  {",
    '  name: "fastify-routes",',
    "  },",
    ");",
  ].join("\n");
}

function generateFile(operations: readonly OperationInfo[]): string {
  return [
    "// This file is auto-generated by the fastify-routes OpenAPI-TS plugin.",
    "// Do not edit manually.",
    "",
    generateImports(operations),
    "",
    generateRoutePaths(operations),
    "",
    generateRouteSchemas(operations),
    "",
    fastifyPluginTypesTemplate,
    "",
    generateFastifyPlugin(operations),
    "",
  ].join("\n");
}

function ensureIndexExport(outputPath: string): void {
  const indexPath = join(outputPath, "index.ts");
  if (!existsSync(indexPath)) {
    return;
  }

  const exportLine = "export * from './fastify-routes.gen.js';";
  const indexContents = readFileSync(indexPath, "utf8");
  if (indexContents.includes(exportLine)) {
    return;
  }

  const suffix = indexContents.endsWith("\n") ? "" : "\n";
  writeFileSync(indexPath, `${indexContents}${suffix}${exportLine}\n`, "utf8");
}

export const fastifyRoutesPlugin: OpenApiTsPlugin = {
  config: {
    includeInEntry: false,
  },
  dependencies: ["@hey-api/typescript", "fastify", "zod"],
  handler: ({ plugin }) => {
    const operations: OperationInfo[] = [];

    // oxlint-disable-next-line unicorn/no-array-for-each -- OpenAPI-TS plugin API exposes this callback as "forEach".
    plugin.forEach(
      "operation",
      ({ operation }) => {
        const responseSchemaRefsByStatus = getResponseSchemaRefsByStatus(
          plugin.context.spec,
          operation,
        );
        operations.push(collectOperationInfo(operation, responseSchemaRefsByStatus));
      },
      { order: "declarations" },
    );

    mkdirSync(plugin.context.config.output.path, { recursive: true });

    const outputPath = join(plugin.context.config.output.path, "fastify-routes.gen.ts");
    writeFileSync(outputPath, generateFile(operations), "utf8");
    ensureIndexExport(plugin.context.config.output.path);
  },
  name: "fastify-routes",
};
