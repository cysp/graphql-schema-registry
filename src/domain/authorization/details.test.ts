import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType, decodeAuthorizationDetailsClaim } from "./details.ts";

await test("decodeAuthorizationDetailsClaim", async (t) => {
  await t.test("returns empty grants when claim is undefined", () => {
    const grants = decodeAuthorizationDetailsClaim();

    assert.deepStrictEqual(grants, []);
  });

  await t.test("decodes graph:manage grants", () => {
    const grants = decodeAuthorizationDetailsClaim([
      {
        graph_id: "*",
        scope: "graph:manage",
        type: authorizationDetailsType,
      },
      {
        graph_id: "alpha",
        scope: "graph:manage",
        type: authorizationDetailsType,
      },
    ]);

    assert.deepStrictEqual(grants, [
      {
        graphId: "*",
        scope: "graph:manage",
      },
      {
        graphId: "alpha",
        scope: "graph:manage",
      },
    ]);
  });

  await t.test("decodes supergraph_schema:read grants", () => {
    const grants = decodeAuthorizationDetailsClaim([
      {
        graph_id: "alpha",
        scope: "supergraph_schema:read",
        type: authorizationDetailsType,
      },
    ]);

    assert.deepStrictEqual(grants, [
      {
        graphId: "alpha",
        scope: "supergraph_schema:read",
      },
    ]);
  });

  await t.test("decodes subgraph_schema grants", () => {
    const grants = decodeAuthorizationDetailsClaim([
      {
        graph_id: "alpha",
        scope: "subgraph_schema:read",
        subgraph_id: "*",
        type: authorizationDetailsType,
      },
      {
        graph_id: "*",
        scope: "subgraph_schema:write",
        subgraph_id: "inventory",
        type: authorizationDetailsType,
      },
    ]);

    assert.deepStrictEqual(grants, [
      {
        graphId: "alpha",
        scope: "subgraph_schema:read",
        subgraphId: "*",
      },
      {
        graphId: "*",
        scope: "subgraph_schema:write",
        subgraphId: "inventory",
      },
    ]);
  });

  await t.test("throws for non-array claim values", () => {
    assert.throws(() => {
      decodeAuthorizationDetailsClaim({
        graph_id: "alpha",
        scope: "graph:manage",
        type: authorizationDetailsType,
      });
    }, /Invalid input/);
  });

  await t.test("throws when graph_id is missing", () => {
    assert.throws(() => {
      decodeAuthorizationDetailsClaim([
        {
          scope: "graph:manage",
          type: authorizationDetailsType,
        },
      ]);
    }, /Invalid input/);
  });

  await t.test("throws when subgraph_id is missing for subgraph_schema grants", () => {
    assert.throws(() => {
      decodeAuthorizationDetailsClaim([
        {
          graph_id: "alpha",
          scope: "subgraph_schema:read",
          type: authorizationDetailsType,
        },
      ]);
    }, /Invalid input/);
  });

  await t.test("throws when graph_id or subgraph_id are empty strings", () => {
    assert.throws(() => {
      decodeAuthorizationDetailsClaim([
        {
          graph_id: "",
          scope: "graph:manage",
          type: authorizationDetailsType,
        },
      ]);
    }, /Invalid input/);

    assert.throws(() => {
      decodeAuthorizationDetailsClaim([
        {
          graph_id: "alpha",
          scope: "subgraph_schema:write",
          subgraph_id: "",
          type: authorizationDetailsType,
        },
      ]);
    }, /Invalid input/);
  });

  await t.test("throws for details with an unexpected type", () => {
    assert.throws(() => {
      decodeAuthorizationDetailsClaim([
        {
          graph_id: "alpha",
          scope: "graph:manage",
          type: "other-service",
        },
      ]);
    }, /Invalid input/);
  });
});
