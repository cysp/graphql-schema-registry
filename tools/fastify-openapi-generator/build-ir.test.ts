import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenApiRouteCatalog } from "./build-ir.ts";

type TestDocument = {
  openapi: string;
  paths: Record<string, unknown>;
};

function createBaseDocument(): TestDocument {
  return {
    openapi: "3.1.0",
    paths: {
      "/widgets": {
        get: {
          operationId: "listWidgets",
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    additionalProperties: false,
                    properties: {
                      items: {
                        items: {
                          additionalProperties: false,
                          properties: {
                            id: {
                              type: "string",
                            },
                          },
                          required: ["id"],
                          type: "object",
                        },
                        type: "array",
                      },
                    },
                    required: ["items"],
                    type: "object",
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

await test("buildOpenApiRouteCatalog", async (t) => {
  await t.test("produces operation data for a valid document", () => {
    const result = buildOpenApiRouteCatalog(createBaseDocument());
    const firstOperation = result.operations[0];
    assert.ok(firstOperation);

    assert.equal(result.operations.length, 1);
    assert.equal(firstOperation.operationId, "listWidgets");
    assert.equal(firstOperation.httpMethod, "GET");
    assert.equal(firstOperation.fastifyPath, "/widgets");
  });

  await t.test("throws when operation ids collide", () => {
    const document = createBaseDocument();
    document.paths = {
      "/widgets": document.paths["/widgets"],
      "/widgets/{widgetId}": {
        get: {
          operationId: "listWidgets",
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
            "200": {
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
    };

    assert.throws(
      () => {
        buildOpenApiRouteCatalog(document);
      },
      {
        message: 'Duplicate operationId "listWidgets" found.',
      },
    );
  });

  await t.test("throws when unsupported cookie parameters are used", () => {
    const document = createBaseDocument();
    document.paths = {
      "/widgets": {
        get: {
          operationId: "listWidgets",
          parameters: [
            {
              in: "cookie",
              name: "sessionId",
              required: false,
              schema: {
                type: "string",
              },
            },
          ],
          responses: {
            "200": {
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
    };

    assert.throws(
      () => {
        buildOpenApiRouteCatalog(document);
      },
      {
        message: /unsupported parameter location "cookie"/,
      },
    );
  });

  await t.test("throws when an operationId is not a TypeScript identifier", () => {
    const document = createBaseDocument();
    document.paths = {
      "/widgets": {
        get: {
          operationId: "list-widgets",
          responses: {
            "200": {
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
    };

    assert.throws(
      () => {
        buildOpenApiRouteCatalog(document);
      },
      {
        message: /must be a valid TypeScript identifier/,
      },
    );
  });

  await t.test("throws when a parameter schema is not an object", () => {
    const document = createBaseDocument();
    document.paths = {
      "/widgets": {
        get: {
          operationId: "listWidgets",
          parameters: [
            {
              in: "query",
              name: "page",
              schema: "string",
            },
          ],
          responses: {
            "200": {
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
    };

    assert.throws(
      () => {
        buildOpenApiRouteCatalog(document);
      },
      {
        message: /parameters\[0\]\.schema must be an object/,
      },
    );
  });
});
