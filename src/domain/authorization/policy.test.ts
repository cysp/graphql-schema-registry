import assert from "node:assert/strict";
import test from "node:test";

import {
  canCreateGraph,
  canManageGraph,
  canReadSubgraphSchema,
  canReadSupergraphSchema,
  canWriteSubgraphSchema,
  managedGraphFilter,
} from "./policy.ts";
import type { AuthorizationGrant } from "./user.ts";

function createGrants(...grants: readonly AuthorizationGrant[]): readonly AuthorizationGrant[] {
  return grants;
}

await test("graph manage policy", async (t) => {
  await t.test("canCreateGraph requires wildcard graph:manage", () => {
    assert.equal(canCreateGraph(createGrants({ graphId: "alpha", scope: "graph:manage" })), false);
    assert.equal(canCreateGraph(createGrants({ graphId: "*", scope: "graph:manage" })), true);
  });

  await t.test("canManageGraph supports concrete and wildcard graph IDs", () => {
    const concrete = createGrants({ graphId: "alpha", scope: "graph:manage" });
    const wildcard = createGrants({ graphId: "*", scope: "graph:manage" });

    assert.equal(canManageGraph(concrete, "alpha"), true);
    assert.equal(canManageGraph(concrete, "beta"), false);
    assert.equal(canManageGraph(wildcard, "alpha"), true);
    assert.equal(canManageGraph(wildcard, "beta"), true);
  });

  await t.test("managedGraphFilter returns all for wildcard grants", () => {
    const filter = managedGraphFilter(
      createGrants(
        { graphId: "alpha", scope: "graph:manage" },
        { graphId: "*", scope: "graph:manage" },
      ),
    );
    assert.deepStrictEqual(filter, { kind: "all" });
  });

  await t.test("managedGraphFilter returns concrete ID set without wildcard", () => {
    const filter = managedGraphFilter(
      createGrants(
        { graphId: "alpha", scope: "graph:manage" },
        { graphId: "beta", scope: "graph:manage" },
      ),
    );
    assert.equal(filter.kind, "ids");
    assert.deepStrictEqual(Array.from(filter.graphIds).toSorted(), ["alpha", "beta"]);
  });
});

await test("schema policy", async (t) => {
  await t.test("canReadSupergraphSchema supports concrete and wildcard graph IDs", () => {
    assert.equal(
      canReadSupergraphSchema(
        createGrants({ graphId: "alpha", scope: "supergraph_schema:read" }),
        "alpha",
      ),
      true,
    );
    assert.equal(
      canReadSupergraphSchema(
        createGrants({ graphId: "alpha", scope: "supergraph_schema:read" }),
        "beta",
      ),
      false,
    );
    assert.equal(
      canReadSupergraphSchema(
        createGrants({ graphId: "*", scope: "supergraph_schema:read" }),
        "beta",
      ),
      true,
    );
  });

  await t.test("canReadSubgraphSchema supports graph and subgraph wildcards", () => {
    const concrete = createGrants({
      graphId: "alpha",
      scope: "subgraph_schema:read",
      subgraphId: "inventory",
    });
    const wildcardGraph = createGrants({
      graphId: "*",
      scope: "subgraph_schema:read",
      subgraphId: "inventory",
    });
    const wildcardSubgraph = createGrants({
      graphId: "alpha",
      scope: "subgraph_schema:read",
      subgraphId: "*",
    });
    const wildcardBoth = createGrants({
      graphId: "*",
      scope: "subgraph_schema:read",
      subgraphId: "*",
    });

    assert.equal(canReadSubgraphSchema(concrete, "alpha", "inventory"), true);
    assert.equal(canReadSubgraphSchema(concrete, "alpha", "products"), false);
    assert.equal(canReadSubgraphSchema(concrete, "beta", "inventory"), false);
    assert.equal(canReadSubgraphSchema(wildcardGraph, "beta", "inventory"), true);
    assert.equal(canReadSubgraphSchema(wildcardSubgraph, "alpha", "products"), true);
    assert.equal(canReadSubgraphSchema(wildcardBoth, "beta", "products"), true);
  });

  await t.test("canWriteSubgraphSchema supports graph and subgraph wildcards", () => {
    const grant = createGrants({
      graphId: "*",
      scope: "subgraph_schema:write",
      subgraphId: "*",
    });

    assert.equal(canWriteSubgraphSchema(grant, "alpha", "inventory"), true);
    assert.equal(canWriteSubgraphSchema(grant, "beta", "products"), true);
  });
});
