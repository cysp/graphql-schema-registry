import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenApiOperations } from "./build-ir.ts";
import { emitGeneratedOpenApiFiles } from "./emit-files.ts";
import type { GeneratedFile } from "./types.ts";

type TestOperation = Record<string, unknown>;
type TestDocument = {
  openapi: string;
  paths: Record<string, Record<string, TestOperation>>;
};

function createOperationDocument(
  operation: TestOperation,
  options: {
    method?: string;
    path?: string;
  } = {},
): TestDocument {
  const { method = "get", path = "/widgets" } = options;

  return {
    openapi: "3.1.0",
    paths: {
      [path]: {
        [method]: operation,
      },
    },
  };
}

function createGeneratedFileMap(files: GeneratedFile[]): Map<string, string> {
  return new Map(files.map((file) => [file.relativePath, file.content]));
}

function createGeneratedFileMapForDocument(document: TestDocument): Map<string, string> {
  return createGeneratedFileMap(emitGeneratedOpenApiFiles(buildOpenApiOperations(document)));
}

function createDocumentWithNamedOperations(): TestDocument {
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
                      pattern: "^v[0-9]+\\.[0-9]+$",
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
  const generatedFileMap = createGeneratedFileMapForDocument(createDocumentWithNamedOperations());

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
    assert.match(source, /"pattern": "\^v\[0-9\]\+\\\\\.\[0-9\]\+\$"/);
    assert.match(
      source,
      /response: \{[\s\S]*200: \{[\s\S]*"content": \{[\s\S]*"application\/json": \{[\s\S]*"schema": \{/,
    );
    assert.match(source, /response: \{[\s\S]*400: \{\},[\s\S]*401: \{\},/);
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

  await t.test(
    "map, enum, and nullable schemas are preserved in emitted JSON Schema literals",
    () => {
      const fileMap = createGeneratedFileMapForDocument(
        createOperationDocument(
          {
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
          { path: "/health" },
        ),
      );

      const source = getGeneratedFile(fileMap, "operations/get-health.ts");

      assert.match(source, /"enum": \[\s*"ok",\s*"warn",\s*"error"\s*\]/);
      assert.match(source, /"additionalProperties": \{/);
      assert.match(source, /"additionalProperties": \{[\s\S]*"type": "string"/);
      assert.match(source, /"type": \[\s*"string",\s*"null"\s*\]/);
      assert.match(source, /response: \{[\s\S]*200: \{[\s\S]*"content": \{/);
    },
  );

  await t.test("response content maps are emitted for multiple documented media types", () => {
    const fileMap = createGeneratedFileMapForDocument(
      createOperationDocument(
        {
          operationId: "getSupergraph",
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      revision: {
                        type: "string",
                      },
                    },
                    required: ["revision"],
                  },
                },
                "text/plain": {
                  schema: {
                    type: "string",
                  },
                },
              },
            },
          },
        },
        { path: "/supergraph.graphqls" },
      ),
    );

    const source = getGeneratedFile(fileMap, "operations/get-supergraph.ts");
    assert.match(source, /200: \{[\s\S]*"content": \{/);
    assert.match(source, /"application\/json": \{[\s\S]*"schema": \{[\s\S]*"revision"/);
    assert.match(source, /"text\/plain": \{[\s\S]*"schema": \{[\s\S]*"type": "string"/);
  });

  await t.test("prototype-sensitive operation ids are emitted as computed keys", () => {
    const fileMap = createGeneratedFileMapForDocument(
      createOperationDocument({
        operationId: "__proto__",
        responses: {
          "204": {},
        },
      }),
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
