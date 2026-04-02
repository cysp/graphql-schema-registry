import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenApiOperations } from "./build-ir.ts";

type TestDocument = {
  openapi: string;
  paths: Record<string, unknown>;
};

function createOperationDocument(
  operation: Record<string, unknown>,
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

function createSimpleResponseOperation(
  operationId: string,
  schema?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    operationId,
    responses: {
      "200": {
        content: {
          "application/json": {
            schema: schema ?? {
              type: "string",
            },
          },
        },
      },
    },
  };
}

function createRequestBodyOperation(
  content: Record<string, { schema: Record<string, unknown> }>,
): Record<string, unknown> {
  return {
    operationId: "createWidget",
    requestBody: {
      content,
      required: true,
    },
    responses: {
      "204": {},
    },
  };
}

function assertBuildError(document: TestDocument, expectedMessage: RegExp | string): void {
  assert.throws(
    () => {
      buildOpenApiOperations(document);
    },
    {
      message: expectedMessage,
    },
  );
}

function createBaseDocument(): TestDocument {
  return createOperationDocument({
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
  });
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
          ...createSimpleResponseOperation("listWidgets"),
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
        },
      },
    };

    assertBuildError(document, 'Duplicate operationId "listWidgets" found.');
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
        post: createRequestBodyOperation({
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
        }),
      },
    };

    assert.deepEqual(
      buildOpenApiOperations(document).map((operation) => operation.operationId),
      ["createWidget"],
    );
  });

  await t.test("throws when requestBody.required is omitted", () => {
    assertBuildError(
      createOperationDocument(
        {
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
        { method: "post" },
      ),
      /requestBody must set required: true when a request body is defined/,
    );
  });

  await t.test("allows multiple content types when a supported one can be selected", () => {
    const [operation] = buildOpenApiOperations(
      createOperationDocument(
        createRequestBodyOperation({
          "application/json": {
            schema: {
              type: "string",
            },
          },
          "application/xml": {
            schema: {
              type: "string",
            },
          },
        }),
        { method: "post" },
      ),
    );

    assert.equal(operation?.operationId, "createWidget");
  });

  await t.test(
    "prefers text/plain when it is the only supported content type among multiple entries",
    () => {
      const [operation] = buildOpenApiOperations(
        createOperationDocument(
          createRequestBodyOperation({
            "application/xml": {
              schema: {
                type: "string",
              },
            },
            "text/plain": {
              schema: {
                type: "string",
              },
            },
          }),
          { method: "post" },
        ),
      );

      assert.deepEqual(operation?.schema.body, {
        type: "string",
      });
    },
  );

  await t.test(
    "throws when multiple supported JSON content types are present alongside text/plain",
    () => {
      assertBuildError(
        createOperationDocument(
          createRequestBodyOperation({
            "application/merge-patch+json": {
              schema: {
                additionalProperties: false,
                properties: {
                  name: {
                    type: "string",
                  },
                },
                type: "object",
              },
            },
            "application/problem+json": {
              schema: {
                additionalProperties: false,
                properties: {
                  title: {
                    type: "string",
                  },
                },
                type: "object",
              },
            },
            "text/plain": {
              schema: {
                type: "string",
              },
            },
          }),
          { method: "post" },
        ),
        /must include a supported content type \(application\/json, a single application\/\*\+json variant, or text\/plain\)/,
      );
    },
  );

  await t.test("supports array-valued type for nullable OpenAPI 3.1 schemas", () => {
    const [operation] = buildOpenApiOperations(
      createOperationDocument({
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
      }),
    );

    assert.deepEqual(operation?.schema.response["200"], {
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
    });
  });

  await t.test("allows response media types to omit schema", () => {
    const [operation] = buildOpenApiOperations(
      createOperationDocument({
        operationId: "getWidgetExport",
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  additionalProperties: false,
                  properties: {
                    id: {
                      type: "string",
                    },
                  },
                  required: ["id"],
                  type: "object",
                },
              },
              "text/plain": {},
            },
          },
        },
      }),
    );

    assert.deepEqual(operation?.schema.response["200"], {
      content: {
        "application/json": {
          schema: {
            additionalProperties: false,
            properties: {
              id: {
                type: "string",
              },
            },
            required: ["id"],
            type: "object",
          },
        },
        "text/plain": {
          schema: {},
        },
      },
    });
  });

  await t.test("returns an empty operation list when no operations have an operationId", () => {
    assert.deepEqual(
      buildOpenApiOperations(
        createOperationDocument({
          responses: {
            "204": {},
          },
        }),
      ),
      [],
    );
  });

  await t.test("throws when unsupported cookie parameters are used", () => {
    assertBuildError(
      createOperationDocument({
        ...createSimpleResponseOperation("listWidgets"),
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
      }),
      /unsupported parameter location "cookie"/,
    );
  });

  await t.test("throws when an operationId is not a TypeScript identifier", () => {
    assertBuildError(
      createOperationDocument(createSimpleResponseOperation("list-widgets")),
      /must be a valid TypeScript identifier/,
    );
  });

  await t.test("throws when a parameter schema is not an object", () => {
    assertBuildError(
      createOperationDocument({
        ...createSimpleResponseOperation("listWidgets"),
        parameters: [
          {
            in: "query",
            name: "page",
            schema: "string",
          },
        ],
      }),
      /parameters\[0\]\.schema must be an object/,
    );
  });

  await t.test(
    "supports primitive schemas, enum values, and schema-valued additionalProperties",
    () => {
      const [operation] = buildOpenApiOperations(
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
          { path: "/health" },
        ),
      );

      const jsonResponseSchema =
        operation?.schema.response["200"]?.content["application/json"]?.schema;
      assert.ok(jsonResponseSchema);
      assert.deepEqual(jsonResponseSchema.properties?.["status"], {
        enum: ["ok", "warn", "error"],
        type: "string",
      });
      assert.deepEqual(jsonResponseSchema.properties["checks"], {
        additionalProperties: {
          enum: ["ok", "warn", "error"],
          type: "string",
        },
        type: "object",
      });
      assert.deepEqual(jsonResponseSchema.properties["ok"], {
        type: "boolean",
      });
      assert.deepEqual(jsonResponseSchema.properties["retryAfterSeconds"], {
        type: "integer",
      });
    },
  );

  await t.test("preserves all documented response media types for a status", () => {
    const [operation] = buildOpenApiOperations(
      createOperationDocument({
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
      }),
    );

    assert.deepEqual(operation?.schema.response["200"], {
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
    });
  });

  await t.test("sorts documented response media types to keep generated output stable", () => {
    const [operation] = buildOpenApiOperations(
      createOperationDocument({
        operationId: "listWidgets",
        responses: {
          "200": {
            content: {
              "text/plain": {
                schema: {
                  type: "string",
                },
              },
              "application/problem+json": {
                schema: {
                  type: "object",
                },
              },
              "application/json": {
                schema: {
                  type: "object",
                },
              },
            },
          },
        },
      }),
    );

    assert.deepEqual(Object.keys(operation?.schema.response["200"]?.content ?? {}), [
      "application/json",
      "application/problem+json",
      "text/plain",
    ]);
  });

  await t.test("throws when a path template parameter has no declared path parameter", () => {
    assertBuildError(
      createOperationDocument(createSimpleResponseOperation("getWidget"), {
        path: "/widgets/{widgetId}",
      }),
      /path template parameters must match declared path parameters; missing path parameter declarations for: widgetId/,
    );
  });

  await t.test("throws when a declared path parameter is not present in the path template", () => {
    assertBuildError(
      createOperationDocument({
        ...createSimpleResponseOperation("listWidgets"),
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
      }),
      /path template parameters must match declared path parameters; declared path parameters not present in template: widgetId/,
    );
  });
});
