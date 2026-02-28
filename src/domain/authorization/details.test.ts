import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType, decodeAuthorizationDetailsClaim } from "./details.ts";

const graphUuid = "11111111-1111-4111-8111-111111111111";
const subgraphUuid = "22222222-2222-4222-8222-222222222222";

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
        graph_id: graphUuid,
        scope: "graph:read",
        type: authorizationDetailsType,
      },
    ]);

    assert.deepStrictEqual(grants, [
      {
        graphId: graphUuid,
        scope: "graph:read",
      },
    ]);
  });

  await t.test("decodes subgraph:write grants", () => {
    const grants = decodeAuthorizationDetailsClaim([
      {
        graph_id: graphUuid,
        scope: "subgraph:write",
        subgraph_id: subgraphUuid,
        type: authorizationDetailsType,
      },
    ]);

    assert.deepStrictEqual(grants, [
      {
        graphId: graphUuid,
        scope: "subgraph:write",
        subgraphId: subgraphUuid,
      },
    ]);
  });

  await t.test("throws for graph:read grants with non-uuid graph_id", () => {
    assert.throws(() => {
      decodeAuthorizationDetailsClaim([
        {
          graph_id: "alpha",
          scope: "graph:read",
          type: authorizationDetailsType,
        },
      ]);
    }, /Invalid input/);
  });

  await t.test("throws for subgraph:write grants with non-uuid ids", () => {
    assert.throws(() => {
      decodeAuthorizationDetailsClaim([
        {
          graph_id: graphUuid,
          scope: "subgraph:write",
          subgraph_id: "inventory",
          type: authorizationDetailsType,
        },
      ]);
    }, /Invalid input/);
  });

  await t.test("throws for graph:read grants with non-v4 UUID", () => {
    assert.throws(() => {
      decodeAuthorizationDetailsClaim([
        {
          graph_id: "11111111-1111-1111-8111-111111111111",
          scope: "graph:read",
          type: authorizationDetailsType,
        },
      ]);
    }, /Invalid input/);
  });

  await t.test("throws for non-array claim values", () => {
    assert.throws(() => {
      decodeAuthorizationDetailsClaim({
        graph_id: graphUuid,
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

  await t.test("throws when subgraph:write is missing graph_id", () => {
    assert.throws(() => {
      decodeAuthorizationDetailsClaim([
        {
          scope: "subgraph:write",
          subgraph_id: subgraphUuid,
          type: authorizationDetailsType,
        },
      ]);
    }, /Invalid input/);
  });

  await t.test("throws when subgraph:write is missing subgraph_id", () => {
    assert.throws(() => {
      decodeAuthorizationDetailsClaim([
        {
          graph_id: graphUuid,
          scope: "subgraph:write",
          type: authorizationDetailsType,
        },
      ]);
    }, /Invalid input/);
  });

  await t.test("decodes multiple mixed grants in one claim", () => {
    const grants = decodeAuthorizationDetailsClaim([
      {
        scope: "admin",
        type: authorizationDetailsType,
      },
      {
        graph_id: graphUuid,
        scope: "graph:read",
        type: authorizationDetailsType,
      },
      {
        graph_id: graphUuid,
        scope: "subgraph:write",
        subgraph_id: subgraphUuid,
        type: authorizationDetailsType,
      },
    ]);

    assert.deepStrictEqual(grants, [
      {
        scope: "admin",
      },
      {
        graphId: graphUuid,
        scope: "graph:read",
      },
      {
        graphId: graphUuid,
        scope: "subgraph:write",
        subgraphId: subgraphUuid,
      },
    ]);
  });
});
