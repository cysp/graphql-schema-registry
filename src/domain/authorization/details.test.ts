import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType, decodeAuthorizationDetailsClaim } from "./details.ts";

await test("decodeAuthorizationDetailsClaim", async (t) => {
  await t.test("returns empty grants when claim is undefined", () => {
    const grants = decodeAuthorizationDetailsClaim();

    assert.deepStrictEqual(grants, []);
  });

  await t.test("decodes admin grants", () => {
    const grants = decodeAuthorizationDetailsClaim([
      {
        scope: "admin",
        type: authorizationDetailsType,
      },
    ]);

    assert.deepStrictEqual(grants, [
      {
        scope: "admin",
      },
    ]);
  });

  await t.test("decodes graph:read grants", () => {
    const grants = decodeAuthorizationDetailsClaim([
      {
        graph_id: "alpha",
        scope: "graph:read",
        type: authorizationDetailsType,
      },
    ]);

    assert.deepStrictEqual(grants, [
      {
        graphId: "alpha",
        scope: "graph:read",
      },
    ]);
  });

  await t.test("decodes subgraph:write grants", () => {
    const grants = decodeAuthorizationDetailsClaim([
      {
        graph_id: "alpha",
        scope: "subgraph:write",
        subgraph_id: "inventory",
        type: authorizationDetailsType,
      },
    ]);

    assert.deepStrictEqual(grants, [
      {
        graphId: "alpha",
        scope: "subgraph:write",
        subgraphId: "inventory",
      },
    ]);
  });

  await t.test("accepts empty graph_id for graph:read grants", () => {
    const grants = decodeAuthorizationDetailsClaim([
      {
        graph_id: "",
        scope: "graph:read",
        type: authorizationDetailsType,
      },
    ]);

    assert.deepStrictEqual(grants, [
      {
        graphId: "",
        scope: "graph:read",
      },
    ]);
  });

  await t.test("accepts empty graph_id and subgraph_id for subgraph:write grants", () => {
    const grants = decodeAuthorizationDetailsClaim([
      {
        graph_id: "",
        scope: "subgraph:write",
        subgraph_id: "",
        type: authorizationDetailsType,
      },
    ]);

    assert.deepStrictEqual(grants, [
      {
        graphId: "",
        scope: "subgraph:write",
        subgraphId: "",
      },
    ]);
  });

  await t.test("throws for non-array claim values", () => {
    assert.throws(() => {
      decodeAuthorizationDetailsClaim({
        graph_id: "alpha",
        scope: "graph:read",
        type: authorizationDetailsType,
      });
    }, /Invalid input/);
  });

  await t.test("throws when graph:read detail is missing graph_id", () => {
    assert.throws(() => {
      decodeAuthorizationDetailsClaim([
        {
          scope: "graph:read",
          type: authorizationDetailsType,
        },
      ]);
    }, /Invalid input/);
  });

  await t.test("throws for details with an unexpected type", () => {
    assert.throws(() => {
      decodeAuthorizationDetailsClaim([
        {
          scope: "admin",
          type: "other-service",
        },
      ]);
    }, /Invalid input/);
  });
});
