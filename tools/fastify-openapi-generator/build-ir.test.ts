import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenApiOperations } from "./build-ir.ts";

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

await test("buildOpenApiOperations", async (t) => {
  await t.test("produces operation data for a valid document", () => {
    const result = buildOpenApiOperations(createBaseDocument());
    const firstOperation = result[0];
    assert.ok(firstOperation);

    assert.equal(result.length, 1);
    assert.equal(firstOperation.operationId, "listWidgets");
    assert.equal(firstOperation.method, "GET");
    assert.equal(firstOperation.url, "/widgets");
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
        buildOpenApiOperations(document);
      },
      {
        message: 'Duplicate operationId "listWidgets" found.',
      },
    );
  });

  await t.test("ignores operations without an operationId", () => {
    const document = createBaseDocument();
    document.paths = {
      "/widgets": {
        get: {
          responses: {
            "204": {},
          },
        },
        post: {
          operationId: "createWidget",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  additionalProperties: false,
                  properties: {
                    name: {
                      type: "string",
                    },
                  },
                  required: ["name"],
                  type: "object",
                },
              },
            },
            required: true,
          },
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
    };

    const result = buildOpenApiOperations(document);

    assert.deepEqual(
      result.map((operation) => operation.operationId),
      ["createWidget"],
    );
  });

  await t.test("throws when requestBody.required is omitted", () => {
    const document = createBaseDocument();
    document.paths = {
      "/widgets": {
        post: {
          operationId: "createWidget",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "string",
                },
              },
            },
          },
          responses: {
            "204": {},
          },
        },
      },
    };

    assert.throws(
      () => {
        buildOpenApiOperations(document);
      },
      {
        message: /requestBody must set required: true when a request body is defined/,
      },
    );
  });

  await t.test("supports text/plain request and response bodies", () => {
    const document = createBaseDocument();
    document.paths = {
      "/widgets/schema.graphqls": {
        get: {
          operationId: "getWidgetSchema",
          responses: {
            "200": {
              content: {
                "text/plain": {
                  schema: {
                    type: "string",
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: "publishWidgetSchema",
          requestBody: {
            content: {
              "text/plain": {
                schema: {
                  type: "string",
                },
              },
            },
            required: true,
          },
          responses: {
            "204": {},
          },
        },
      },
    };

    const result = buildOpenApiOperations(document);
    assert.deepEqual(
      result.map((operation) => [operation.operationId, operation.schema.body]),
      [
        ["getWidgetSchema", undefined],
        ["publishWidgetSchema", { type: "string" }],
      ],
    );
    assert.deepEqual(result[0]?.schema.response["200"], { type: "string" });
  });

  await t.test("supports array-valued type for nullable OpenAPI 3.1 schemas", () => {
    const document = createBaseDocument();
    document.paths = {
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
                      nextCursor: {
                        type: ["string", "null"],
                      },
                    },
                    required: ["nextCursor"],
                    type: "object",
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = buildOpenApiOperations(document);
    const operation = result[0];
    const responseSchema = operation?.schema.response["200"];
    assert.ok(responseSchema);

    assert.deepEqual(responseSchema, {
      additionalProperties: false,
      properties: {
        nextCursor: {
          type: ["string", "null"],
        },
      },
      required: ["nextCursor"],
      type: "object",
    });
  });

  await t.test("returns an empty operation list when no operations have an operationId", () => {
    const document = createBaseDocument();
    document.paths = {
      "/widgets": {
        get: {
          responses: {
            "204": {},
          },
        },
      },
    };

    const result = buildOpenApiOperations(document);

    assert.deepEqual(result, []);
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
        buildOpenApiOperations(document);
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
        buildOpenApiOperations(document);
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
        buildOpenApiOperations(document);
      },
      {
        message: /parameters\[0\]\.schema must be an object/,
      },
    );
  });

  await t.test(
    "supports primitive schemas, enum values, and schema-valued additionalProperties",
    () => {
      const document = createBaseDocument();
      document.paths = {
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
                        ok: {
                          type: "boolean",
                        },
                        retryAfterSeconds: {
                          type: "integer",
                        },
                        status: {
                          enum: ["ok", "warn", "error"],
                          type: "string",
                        },
                      },
                      required: ["status", "checks", "ok", "retryAfterSeconds"],
                      type: "object",
                    },
                  },
                },
              },
            },
          },
        },
      };

      const result = buildOpenApiOperations(document);
      const operation = result[0];
      assert.ok(operation);
      const responseSchema = operation.schema.response["200"];
      assert.ok(responseSchema);
      assert.deepEqual(responseSchema.properties?.["status"], {
        enum: ["ok", "warn", "error"],
        type: "string",
      });
      assert.deepEqual(responseSchema.properties["checks"], {
        additionalProperties: {
          enum: ["ok", "warn", "error"],
          type: "string",
        },
        type: "object",
      });
      assert.deepEqual(responseSchema.properties["ok"], {
        type: "boolean",
      });
      assert.deepEqual(responseSchema.properties["retryAfterSeconds"], {
        type: "integer",
      });
    },
  );

  await t.test("prefers application/json when other media types are also present", () => {
    const document = createBaseDocument();
    document.paths = {
      "/widgets": {
        get: {
          operationId: "listWidgets",
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "string",
                  },
                },
                "application/problem+json": {
                  schema: {
                    type: "object",
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = buildOpenApiOperations(document);

    assert.deepEqual(result[0]?.schema.response["200"], {
      type: "string",
    });
  });

  await t.test("throws when a path template parameter has no declared path parameter", () => {
    const document = createBaseDocument();
    document.paths = {
      "/widgets/{widgetId}": {
        get: {
          operationId: "getWidget",
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
        buildOpenApiOperations(document);
      },
      {
        message:
          /path template parameters must match declared path parameters; missing path parameter declarations for: widgetId/,
      },
    );
  });

  await t.test("throws when a declared path parameter is not present in the path template", () => {
    const document = createBaseDocument();
    document.paths = {
      "/widgets": {
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
        buildOpenApiOperations(document);
      },
      {
        message:
          /path template parameters must match declared path parameters; declared path parameters not present in template: widgetId/,
      },
    );
  });
});
