import assert from "node:assert/strict";
import test from "node:test";

import type { IR } from "@hey-api/openapi-ts";

import { collectResponseInfos } from "./responses.ts";

function createResponse(schema: IR.SchemaObject): IR.ResponseObject {
  return { schema };
}

function createOperation(
  id: string,
  responses: Record<string, IR.ResponseObject | undefined>,
): IR.OperationObject {
  return {
    id,
    method: "get",
    path: "/test",
    responses,
  };
}

await test("collectResponseInfos", async (t) => {
  await t.test("sorts statuses and maps schema refs to zod root symbols", () => {
    const operation = createOperation("listGraphs", {
      "404": createResponse({ $ref: "#/components/schemas/not-found_root" }),
      "200": createResponse({ $ref: "#/components/schemas/graph_root" }),
      default: createResponse({ $ref: "#/components/schemas/root" }),
    });

    const responseInfos = collectResponseInfos(operation);
    assert.deepStrictEqual(responseInfos, [
      { schemaSymbol: "zGraphRoot", status: "200" },
      { schemaSymbol: "zNotFoundRoot", status: "404" },
      { schemaSymbol: "zRoot", status: "default" },
    ]);
  });

  await t.test("maps unknown response schemas to zRoot", () => {
    const operation = createOperation("getGraph", {
      "401": createResponse({ type: "unknown" }),
    });

    const responseInfos = collectResponseInfos(operation);
    assert.deepStrictEqual(responseInfos, [{ schemaSymbol: "zRoot", status: "401" }]);
  });

  await t.test("maps successful void schemas to operation response symbol", () => {
    const operation = createOperation("deleteGraph", {
      "204": createResponse({ type: "void" }),
    });

    const responseInfos = collectResponseInfos(operation);
    assert.deepStrictEqual(responseInfos, [
      { schemaSymbol: "zDeleteGraphResponse", status: "204" },
    ]);
  });

  await t.test("throws for unsupported schema ref prefixes", () => {
    const operation = createOperation("updateGraph", {
      "200": createResponse({ $ref: "#/components/parameters/x-revision-id" }),
    });

    assert.throws(
      () => {
        collectResponseInfos(operation);
      },
      {
        message:
          'Unsupported response schema ref "#/components/parameters/x-revision-id". Only "#/components/schemas/*" refs are supported.',
      },
    );
  });

  await t.test("throws when multiple statuses require operation response symbol fallback", () => {
    const operation = createOperation("updateGraph", {
      "200": createResponse({ type: "object" }),
      "201": createResponse({ type: "object" }),
    });

    assert.throws(
      () => {
        collectResponseInfos(operation);
      },
      {
        message: /has multiple responses that would map to zUpdateGraphResponse/,
      },
    );
  });

  await t.test("throws for non-success inline response schemas without refs", () => {
    const operation = createOperation("updateGraph", {
      "400": createResponse({ type: "object" }),
    });

    assert.throws(
      () => {
        collectResponseInfos(operation);
      },
      {
        message:
          'Unable to resolve response schema symbol for operation "updateGraph" status "400" (schema type: "object").',
      },
    );
  });
});
