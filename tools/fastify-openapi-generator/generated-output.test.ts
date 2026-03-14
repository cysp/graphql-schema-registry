// oxlint-disable eslint/max-lines

import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenApiOperations } from "./build-ir.ts";
import { emitGeneratedOpenApiFiles } from "./emit-files.ts";
import type { GeneratedFile } from "./types.ts";

function createGeneratedFileMap(files: GeneratedFile[]): Map<string, string> {
  return new Map(files.map((file) => [file.relativePath, file.content]));
}

function createDocumentWithNamedOperations(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    paths: {
      "/v1/graphs": {
        get: {
          operationId: "listGraphs",
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    items: {
                      additionalProperties: false,
                      properties: {
                        id: {
                          minLength: 1,
                          type: "string",
                        },
                      },
                      required: ["id"],
                      type: "object",
                    },
                    type: "array",
                  },
                },
              },
            },
          },
        },
      },
      "/v1/graphs/{graphSlug}": {
        put: {
          operationId: "updateGraph",
          parameters: [
            {
              in: "path",
              name: "graphSlug",
              required: true,
              schema: {
                minLength: 1,
                type: "string",
              },
            },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  additionalProperties: false,
                  properties: {
                    federationVersion: {
                      minLength: 1,
                      type: "string",
                    },
                  },
                  required: ["federationVersion"],
                  type: "object",
                },
              },
            },
            required: true,
          },
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    additionalProperties: false,
                    properties: {
                      id: {
                        minLength: 1,
                        type: "string",
                      },
                    },
                    required: ["id"],
                    type: "object",
                  },
                },
              },
            },
            "400": {},
            "401": {},
          },
        },
      },
    },
  };
}

function getGeneratedFile(fileMap: Map<string, string>, relativePath: string): string {
  const file = fileMap.get(relativePath);
  assert.ok(file, `Expected generated file ${relativePath} to exist.`);
  return file;
}

await test("generated output uses fastify-aligned operation naming", async (t) => {
  const generatedFileMap = createGeneratedFileMap(
    emitGeneratedOpenApiFiles(buildOpenApiOperations(createDocumentWithNamedOperations())),
  );

  await t.test("updateGraph operation file exports a single obvious route definition", () => {
    const source = getGeneratedFile(generatedFileMap, "operations/update-graph.ts");

    assert.match(
      source,
      /import type \{ FastifyRouteDefinition \} from "\.\.\/\.\.\/route-types\.ts";/,
    );
    assert.match(source, /export const updateGraphRouteDefinition = \{/);
    assert.match(source, /schema: \{/);
    assert.match(source, /params: \{/);
    assert.match(source, /body: \{/);
    assert.match(source, /response: \{[\s\S]*200: \{[\s\S]*400: \{\},[\s\S]*401: \{\},/);
    assert.doesNotMatch(source, /const updateGraphParamsSchema = /);
    assert.doesNotMatch(source, /const updateGraphHeadersSchema = /);
    assert.doesNotMatch(source, /const updateGraphBodySchema = /);
    assert.doesNotMatch(source, /const updateGraph200ResponseSchema = /);
    assert.match(source, /\} as const satisfies FastifyRouteDefinition;/);
    assert.doesNotMatch(source, /from "\.\.\/components\//);
    assert.equal(generatedFileMap.has("components/graph.ts"), false);
  });

  await t.test("operations index exports only the catalog", () => {
    const source = getGeneratedFile(generatedFileMap, "operations/index.ts");

    assert.match(source, /import \{ listGraphsRouteDefinition \} from "\.\/list-graphs\.ts";/);
    assert.match(source, /import \{ updateGraphRouteDefinition \} from "\.\/update-graph\.ts";/);
    assert.doesNotMatch(source, /export \{/);
    assert.match(source, /export const operationRouteDefinitions = \{/);
    assert.doesNotMatch(source, /export type FastifyOperationRouteDefinitions/);
    assert.match(source, /\["listGraphs"\]: listGraphsRouteDefinition,/);
    assert.match(source, /\["updateGraph"\]: updateGraphRouteDefinition,/);
  });

  await t.test("generated routes module exports handlers and registration code", () => {
    const source = getGeneratedFile(generatedFileMap, "routes.ts");

    assert.match(
      source,
      /import type \{ FastifyJsonSchemaToTsInstance, FastifyRouteHandlerFromDefinition \} from "\.\.\/route-types\.ts";/,
    );
    assert.match(
      source,
      /import \{ operationRouteDefinitions \} from "\.\/operations\/index\.ts";/,
    );
    assert.match(
      source,
      /export type OpenApiOperationHandlers = \{[\s\S]*\[OperationId in keyof typeof operationRouteDefinitions\]: FastifyRouteHandlerFromDefinition<[\s\S]*\(typeof operationRouteDefinitions\)\[OperationId\][\s\S]*>;[\s\S]*\};/,
    );
    assert.match(
      source,
      /server\.route\(\{[\s\S]*\.\.\.operationRouteDefinitions\["listGraphs"\],[\s\S]*handler: operationHandlers\["listGraphs"\],[\s\S]*server\.route\(\{[\s\S]*\.\.\.operationRouteDefinitions\["updateGraph"\],[\s\S]*handler: operationHandlers\["updateGraph"\],[\s\S]*\}\);/,
    );
    assert.match(source, /export function registerOpenApiRoutes\(/);
    assert.doesNotMatch(source, /\sas FastifyRouteHandlerFromDefinition</);
    assert.doesNotMatch(source, /export const openApiRoutesPlugin:/);
  });

  await t.test("unnamed operations are omitted from generated output", () => {
    const fileMap = createGeneratedFileMap(
      emitGeneratedOpenApiFiles(
        buildOpenApiOperations({
          openapi: "3.1.0",
          paths: {
            "/widgets": {
              get: {
                responses: {
                  "204": {},
                },
              },
              post: {
                operationId: "createWidget",
                responses: {
                  "201": {
                    content: {
                      "application/json": {
                        schema: {
                          type: "string",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      ),
    );

    const routeDefinitionsSource = getGeneratedFile(fileMap, "routes.ts");

    assert.match(
      routeDefinitionsSource,
      /\[OperationId in keyof typeof operationRouteDefinitions\]: FastifyRouteHandlerFromDefinition</,
    );
    assert.equal(fileMap.has("operations/index.ts"), true);
    assert.equal(fileMap.has("operations/generated.ts"), false);
    assert.equal(fileMap.has("operations/create-widget.ts"), true);
    assert.equal(fileMap.size, 3);
  });

  await t.test("empty route registries do not emit extra blank lines", () => {
    const fileMap = createGeneratedFileMap(
      emitGeneratedOpenApiFiles(
        buildOpenApiOperations({
          openapi: "3.1.0",
          paths: {
            "/widgets": {
              get: {
                responses: {
                  "204": {},
                },
              },
            },
          },
        }),
      ),
    );

    const source = getGeneratedFile(fileMap, "routes.ts");
    const indexSource = getGeneratedFile(fileMap, "operations/index.ts");

    assert.equal(
      source,
      [
        "// This file is auto-generated by tools/generate-fastify-openapi.ts",
        "",
        'import type { FastifyJsonSchemaToTsInstance, FastifyRouteHandlerFromDefinition } from "../route-types.ts";',
        'import { operationRouteDefinitions } from "./operations/index.ts";',
        "",
        "export type OpenApiOperationHandlers = {",
        "  [OperationId in keyof typeof operationRouteDefinitions]: FastifyRouteHandlerFromDefinition<",
        "    (typeof operationRouteDefinitions)[OperationId]",
        "  >;",
        "};",
        "",
        "export function registerOpenApiRoutes(",
        "  server: FastifyJsonSchemaToTsInstance,",
        "  operationHandlers: OpenApiOperationHandlers,",
        "): void {",
        "  void server;",
        "  void operationHandlers;",
        "}",
        "",
      ].join("\n"),
    );
    assert.equal(
      indexSource,
      [
        "// This file is auto-generated by tools/generate-fastify-openapi.ts",
        "",
        "export const operationRouteDefinitions = {};",
        "",
      ].join("\n"),
    );
  });

  await t.test(
    "map, enum, and nullable schemas are preserved in emitted JSON Schema literals",
    () => {
      const fileMap = createGeneratedFileMap(
        emitGeneratedOpenApiFiles(
          buildOpenApiOperations({
            openapi: "3.1.0",
            paths: {
              "/health": {
                get: {
                  operationId: "getHealth",
                  responses: {
                    "200": {
                      content: {
                        "application/json": {
                          schema: {
                            additionalProperties: false,
                            properties: {
                              checks: {
                                additionalProperties: {
                                  enum: ["ok", "warn", "error"],
                                  type: "string",
                                },
                                type: "object",
                              },
                              status: {
                                enum: ["ok", "warn", "error"],
                                type: "string",
                              },
                              nextCursor: {
                                type: ["string", "null"],
                              },
                            },
                            required: ["status", "checks", "nextCursor"],
                            type: "object",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          }),
        ),
      );

      const source = getGeneratedFile(fileMap, "operations/get-health.ts");

      assert.match(source, /"enum": \[\s*"ok",\s*"warn",\s*"error"\s*\]/);
      assert.match(source, /"additionalProperties": \{/);
      assert.match(source, /"additionalProperties": \{[\s\S]*"type": "string"/);
      assert.match(source, /"type": \[\s*"string",\s*"null"\s*\]/);
      assert.match(source, /response: \{[\s\S]*200: \{/);
    },
  );

  await t.test("prototype-sensitive operation ids are emitted as computed keys", () => {
    const fileMap = createGeneratedFileMap(
      emitGeneratedOpenApiFiles(
        buildOpenApiOperations({
          openapi: "3.1.0",
          paths: {
            "/widgets": {
              get: {
                operationId: "__proto__",
                responses: {
                  "204": {},
                },
              },
            },
          },
        }),
      ),
    );

    const source = getGeneratedFile(fileMap, "operations/index.ts");

    assert.match(source, /\["__proto__"\]: __proto__RouteDefinition,/);
  });

  await t.test("throws when operation file paths collide after kebab-case normalization", () => {
    assert.throws(
      () => {
        emitGeneratedOpenApiFiles(
          buildOpenApiOperations({
            openapi: "3.1.0",
            paths: {
              "/widgets": {
                get: {
                  operationId: "createWidget",
                  responses: {
                    "204": {},
                  },
                },
              },
              "/widgets/{widgetId}": {
                get: {
                  operationId: "create_widget",
                  parameters: [
                    {
                      in: "path",
                      name: "widgetId",
                      required: true,
                      schema: {
                        type: "string",
                      },
                    },
                  ],
                  responses: {
                    "204": {},
                  },
                },
              },
            },
          }),
        );
      },
      {
        message:
          'Generated file path collision: operation "createWidget" and operation "create_widget" both map to "operations/create-widget.ts".',
      },
    );
  });
});
