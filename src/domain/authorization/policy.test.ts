import assert from "node:assert/strict";
import test from "node:test";

import {
  canCreateGraph,
  canManageAnyGraph,
  canManageGraph,
  canReadSubgraphSchema,
  canReadSupergraphSchema,
  canValidateSubgraphSchema,
  canWriteSubgraphSchema,
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

  await t.test("canManageAnyGraph requires wildcard graph:manage", () => {
    assert.equal(
      canManageAnyGraph(createGrants({ graphId: "alpha", scope: "graph:manage" })),
      false,
    );
    assert.equal(canManageAnyGraph(createGrants({ graphId: "*", scope: "graph:manage" })), true);
  });

  await t.test("canManageGraph supports concrete and wildcard graph IDs", () => {
    const concrete = createGrants({ graphId: "alpha", scope: "graph:manage" });
    const wildcard = createGrants({ graphId: "*", scope: "graph:manage" });

    assert.equal(canManageGraph(concrete, "alpha"), true);
    assert.equal(canManageGraph(concrete, "beta"), false);
    assert.equal(canManageGraph(wildcard, "alpha"), true);
    assert.equal(canManageGraph(wildcard, "beta"), true);
    assert.equal(canManageGraph(concrete, undefined), false);
    assert.equal(canManageGraph(wildcard, undefined), true);
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
    assert.equal(
      canReadSupergraphSchema(
        createGrants({ graphId: "alpha", scope: "supergraph_schema:read" }),
        undefined,
      ),
      false,
    );
    assert.equal(
      canReadSupergraphSchema(
        createGrants({ graphId: "*", scope: "supergraph_schema:read" }),
        undefined,
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
    assert.equal(canReadSubgraphSchema(concrete, undefined, "inventory"), false);
    assert.equal(canReadSubgraphSchema(wildcardGraph, undefined, "inventory"), true);
    assert.equal(canReadSubgraphSchema(wildcardSubgraph, "alpha", undefined), true);
    assert.equal(canReadSubgraphSchema(wildcardBoth, undefined, undefined), true);
  });

  await t.test("canWriteSubgraphSchema supports graph and subgraph wildcards", () => {
    const grant = createGrants({
      graphId: "*",
      scope: "subgraph_schema:write",
      subgraphId: "*",
    });
    const concrete = createGrants({
      graphId: "alpha",
      scope: "subgraph_schema:write",
      subgraphId: "inventory",
    });

    assert.equal(canWriteSubgraphSchema(grant, "alpha", "inventory"), true);
    assert.equal(canWriteSubgraphSchema(grant, "beta", "products"), true);
    assert.equal(canWriteSubgraphSchema(concrete, undefined, "inventory"), false);
    assert.equal(canWriteSubgraphSchema(grant, undefined, "inventory"), true);
    assert.equal(canWriteSubgraphSchema(grant, "alpha", undefined), true);
    assert.equal(canWriteSubgraphSchema(grant, undefined, undefined), true);
  });

  await t.test("canValidateSubgraphSchema allows validate and write grants", () => {
    const validateGrant = createGrants({
      graphId: "alpha",
      scope: "subgraph_schema:validate",
      subgraphId: "inventory",
    });
    const writeGrant = createGrants({
      graphId: "*",
      scope: "subgraph_schema:write",
      subgraphId: "*",
    });

    assert.equal(canValidateSubgraphSchema(validateGrant, "alpha", "inventory"), true);
    assert.equal(canValidateSubgraphSchema(validateGrant, "alpha", "products"), false);
    assert.equal(canValidateSubgraphSchema(writeGrant, "alpha", "products"), true);
    assert.equal(canValidateSubgraphSchema(validateGrant, undefined, "inventory"), false);
    assert.equal(canValidateSubgraphSchema(writeGrant, undefined, undefined), true);
  });
});
