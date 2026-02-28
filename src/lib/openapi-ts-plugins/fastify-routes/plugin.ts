import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { IR } from "@hey-api/openapi-ts";

type OperationInfo = {
  hasBody: boolean;
  hasHeaders: boolean;
  hasPath: boolean;
  hasQuery: boolean;
  id: string;
  method: string;
  path: string;
  successStatuses: string[];
};

type PluginInstance = {
  context: {
    config: {
      output: {
        path: string;
      };
    };
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

function getSuccessStatuses(operation: IR.OperationObject): string[] {
  if (!operation.responses) {
    return [];
  }

  return Object.keys(operation.responses)
    .filter((status) => /^[0-9]{3}$/.test(status) && status.startsWith("2"))
    .toSorted((a, b) => Number(a) - Number(b));
}

function collectOperationInfo(operation: IR.OperationObject): OperationInfo {
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
    successStatuses: getSuccessStatuses(operation),
  };
}

function generateImports(operations: readonly OperationInfo[]): string {
  const zodSymbols = new Set<string>();

  for (const operation of operations) {
    const name = toPascalCase(operation.id);
    const dataSymbol = `z${name}Data`;
    const responseSymbol = `z${name}Response`;

    if (operation.hasBody || operation.hasHeaders || operation.hasPath || operation.hasQuery) {
      zodSymbols.add(dataSymbol);
    }

    if (operation.successStatuses.length > 0) {
      zodSymbols.add(responseSymbol);
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

  if (operation.successStatuses.length > 0) {
    const responseSymbol = `z${operationName}Response`;
    const responses = operation.successStatuses
      .map((status) => `${status}: ${responseSymbol}`)
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

function generatePluginTypes(): string {
  return [
    'type FastifyRouteOptionSubset = Pick<RouteShorthandOptionsWithHandler, "config" | "onRequest" | "preHandler" | "preValidation">;',
    "",
    "type FastifyRouteEntry<THandler extends RouteHandlers[keyof RouteHandlers]> =",
    "  | THandler",
    "  | (FastifyRouteOptionSubset & { handler: THandler });",
    "",
    "export type FastifyRouteEntries = {",
    "  [K in keyof RouteHandlers]: FastifyRouteEntry<RouteHandlers[K]>;",
    "};",
    "",
    "type FastifyRouteOptionsWithHandler<THandler extends RouteHandlers[keyof RouteHandlers]> =",
    "  FastifyRouteOptionSubset & { handler: THandler };",
    "",
    "function normalizeRouteEntry<THandler extends RouteHandlers[keyof RouteHandlers]>(",
    "  entry: FastifyRouteEntry<THandler>,",
    "): FastifyRouteOptionsWithHandler<THandler> {",
    '  if (typeof entry === "function") {',
    "    return { handler: entry };",
    "  }",
    "",
    "  return entry;",
    "}",
    "",
    "export type FastifyRoutesPluginOptions = { routes: FastifyRouteEntries };",
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
    generatePluginTypes(),
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
        operations.push(collectOperationInfo(operation));
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
