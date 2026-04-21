import assert from "node:assert/strict";
import test from "node:test";

import { formatStrongETag } from "./domain/etag.ts";
import {
  createGraph,
  createSubgraph,
  createSubgraphSchemaGrantToken,
  createWildcardSubgraphSchemaGrantToken,
  publishSubgraphSchema,
} from "./test-support/integration-scenarios.ts";
import {
  authorizationHeaders,
  authorizationIfMatchHeaders,
  createGraphManageIntegrationAuth,
  createIntegrationServerFixture,
  parseJson,
  requireIntegrationDatabaseUrl,
} from "./test-support/integration-server.ts";

const baselineInventorySchemaSdl = `
  enum SortDirection {
    ASC
  }

  type Query {
    products: [String!]!
  }
`;

const proposedInventorySchemaSdl = `
  enum SortDirection {
    ASC
    DESC
  }

  type Query {
    products: [Int!]!
    product(id: ID!): String
  }
`;

const conflictingWarehouseSchemaSdl = `
  type Query {
    products: [Int!]!
  }
`;

const invalidSchemaSdl = `
  type Query {
`;

function assertObjectRecord(value: unknown): asserts value is Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.ok(value);
  assert.equal(Array.isArray(value), false);
}

await test("[integration] validate subgraph schema route integration with postgres", async (t) => {
  const integrationDatabaseUrl = requireIntegrationDatabaseUrl(t);
  if (!integrationDatabaseUrl) {
    return;
  }

  const { createToken, graphManageToken, jwtVerification } = createGraphManageIntegrationAuth();

  await t.test("returns 401 when unauthenticated", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification,
    });

    try {
      const response = await fixture.server.inject({
        method: "POST",
        payload: baselineInventorySchemaSdl,
        url: "/v1/graphs/catalog/subgraphs/inventory/validate-schema",
      });

      assert.equal(response.statusCode, 401);
    } finally {
      await fixture.close();
    }
  });

  await t.test("allows subgraph_schema:validate and subgraph_schema:write but not graph:manage", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification,
    });

    try {
      const graph = await createGraph(fixture, graphManageToken, "catalog");
      const subgraph = await createSubgraph(
        fixture,
        graphManageToken,
        graph.slug,
        "inventory",
        "https://inventory.example.com/graphql",
      );
      const currentEtag = await publishSubgraphSchema(
        fixture,
        createToken,
        graph,
        subgraph,
        baselineInventorySchemaSdl,
      );
      assert.equal(currentEtag, formatStrongETag(subgraph.id, 1));

      const validateToken = createSubgraphSchemaGrantToken(
        createToken,
        "subgraph_schema:validate",
        graph.id,
        subgraph.id,
      );
      const validateResponse = await fixture.server.inject({
        headers: {
          ...authorizationHeaders(validateToken),
          "content-type": "text/plain",
        },
        method: "POST",
        payload: proposedInventorySchemaSdl,
        url: `/v1/graphs/${graph.slug}/subgraphs/${subgraph.slug}/validate-schema`,
      });
      assert.equal(validateResponse.statusCode, 200);

      const writeToken = createSubgraphSchemaGrantToken(
        createToken,
        "subgraph_schema:write",
        graph.id,
        subgraph.id,
      );
      const writeResponse = await fixture.server.inject({
        headers: {
          ...authorizationHeaders(writeToken),
          "content-type": "text/plain",
        },
        method: "POST",
        payload: proposedInventorySchemaSdl,
        url: `/v1/graphs/${graph.slug}/subgraphs/${subgraph.slug}/validate-schema`,
      });
      assert.equal(writeResponse.statusCode, 200);

      const graphManageResponse = await fixture.server.inject({
        headers: {
          ...authorizationHeaders(graphManageToken),
          "content-type": "text/plain",
        },
        method: "POST",
        payload: proposedInventorySchemaSdl,
        url: `/v1/graphs/${graph.slug}/subgraphs/${subgraph.slug}/validate-schema`,
      });
      assert.equal(graphManageResponse.statusCode, 403);
    } finally {
      await fixture.close();
    }
  });

  await t.test(
    "returns 403 for scoped validate grants on hidden or missing resources, and 404 for wildcard",
    async () => {
      const fixture = await createIntegrationServerFixture({
        databaseUrl: integrationDatabaseUrl,
        jwtVerification,
      });

      try {
        const visibleGraph = await createGraph(fixture, graphManageToken, "catalog");
        const hiddenGraph = await createGraph(fixture, graphManageToken, "reviews");
        const visibleSubgraph = await createSubgraph(
          fixture,
          graphManageToken,
          visibleGraph.slug,
          "inventory",
          "https://inventory.example.com/graphql",
        );

        const scopedToken = createSubgraphSchemaGrantToken(
          createToken,
          "subgraph_schema:validate",
          visibleGraph.id,
          visibleSubgraph.id,
        );

        const hiddenGraphResponse = await fixture.server.inject({
          headers: {
            ...authorizationHeaders(scopedToken),
            "content-type": "text/plain",
          },
          method: "POST",
          payload: proposedInventorySchemaSdl,
          url: `/v1/graphs/${hiddenGraph.slug}/subgraphs/inventory/validate-schema`,
        });
        assert.equal(hiddenGraphResponse.statusCode, 403);

        const missingGraphResponse = await fixture.server.inject({
          headers: {
            ...authorizationHeaders(scopedToken),
            "content-type": "text/plain",
          },
          method: "POST",
          payload: proposedInventorySchemaSdl,
          url: "/v1/graphs/missing/subgraphs/inventory/validate-schema",
        });
        assert.equal(missingGraphResponse.statusCode, 403);

        const wildcardToken = createWildcardSubgraphSchemaGrantToken(
          createToken,
          "subgraph_schema:validate",
        );

        const wildcardMissingResponse = await fixture.server.inject({
          headers: {
            ...authorizationHeaders(wildcardToken),
            "content-type": "text/plain",
          },
          method: "POST",
          payload: proposedInventorySchemaSdl,
          url: "/v1/graphs/missing/subgraphs/inventory/validate-schema",
        });
        assert.equal(wildcardMissingResponse.statusCode, 404);
      } finally {
        await fixture.close();
      }
    },
  );

  await t.test("returns 422 for invalid proposed schema payloads", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification,
    });

    try {
      const graph = await createGraph(fixture, graphManageToken, "catalog");
      const subgraph = await createSubgraph(
        fixture,
        graphManageToken,
        graph.slug,
        "inventory",
        "https://inventory.example.com/graphql",
      );

      const validateToken = createSubgraphSchemaGrantToken(
        createToken,
        "subgraph_schema:validate",
        graph.id,
        subgraph.id,
      );

      const response = await fixture.server.inject({
        headers: {
          ...authorizationHeaders(validateToken),
          "content-type": "text/plain",
        },
        method: "POST",
        payload: invalidSchemaSdl,
        url: `/v1/graphs/${graph.slug}/subgraphs/${subgraph.slug}/validate-schema`,
      });

      assert.equal(response.statusCode, 422);
    } finally {
      await fixture.close();
    }
  });

  await t.test("enforces optional If-Match preconditions", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification,
    });

    try {
      const graph = await createGraph(fixture, graphManageToken, "catalog");
      const subgraph = await createSubgraph(
        fixture,
        graphManageToken,
        graph.slug,
        "inventory",
        "https://inventory.example.com/graphql",
      );
      const currentEtag = await publishSubgraphSchema(
        fixture,
        createToken,
        graph,
        subgraph,
        baselineInventorySchemaSdl,
      );
      assert.equal(currentEtag, formatStrongETag(subgraph.id, 1));

      const validateToken = createSubgraphSchemaGrantToken(
        createToken,
        "subgraph_schema:validate",
        graph.id,
        subgraph.id,
      );

      const stalePreconditionResponse = await fixture.server.inject({
        headers: {
          ...authorizationIfMatchHeaders(validateToken, formatStrongETag(subgraph.id, 999)),
          "content-type": "text/plain",
        },
        method: "POST",
        payload: proposedInventorySchemaSdl,
        url: `/v1/graphs/${graph.slug}/subgraphs/${subgraph.slug}/validate-schema`,
      });
      assert.equal(stalePreconditionResponse.statusCode, 412);

      const matchingPreconditionResponse = await fixture.server.inject({
        headers: {
          ...authorizationIfMatchHeaders(validateToken, currentEtag),
          "content-type": "text/plain",
        },
        method: "POST",
        payload: proposedInventorySchemaSdl,
        url: `/v1/graphs/${graph.slug}/subgraphs/${subgraph.slug}/validate-schema`,
      });
      assert.equal(matchingPreconditionResponse.statusCode, 200);

      const withoutPreconditionResponse = await fixture.server.inject({
        headers: {
          ...authorizationHeaders(validateToken),
          "content-type": "text/plain",
        },
        method: "POST",
        payload: proposedInventorySchemaSdl,
        url: `/v1/graphs/${graph.slug}/subgraphs/${subgraph.slug}/validate-schema`,
      });
      assert.equal(withoutPreconditionResponse.statusCode, 200);
    } finally {
      await fixture.close();
    }
  });

  await t.test("returns composed diff details for successful validation", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification,
    });

    try {
      const graph = await createGraph(fixture, graphManageToken, "catalog");
      const subgraph = await createSubgraph(
        fixture,
        graphManageToken,
        graph.slug,
        "inventory",
        "https://inventory.example.com/graphql",
      );
      await publishSubgraphSchema(fixture, createToken, graph, subgraph, baselineInventorySchemaSdl);

      const validateToken = createSubgraphSchemaGrantToken(
        createToken,
        "subgraph_schema:validate",
        graph.id,
        subgraph.id,
      );

      const response = await fixture.server.inject({
        headers: {
          ...authorizationHeaders(validateToken),
          "content-type": "text/plain",
        },
        method: "POST",
        payload: proposedInventorySchemaSdl,
        url: `/v1/graphs/${graph.slug}/subgraphs/${subgraph.slug}/validate-schema`,
      });

      assert.equal(response.statusCode, 200);
      const payload = parseJson(response);
      assertObjectRecord(payload);
      assert.equal(payload["composed"], true);

      const summary = payload["summary"];
      assertObjectRecord(summary);
      assert.equal(summary["totalChanges"], 3);
      assert.equal(summary["breakingChanges"], 1);
      assert.equal(summary["dangerousChanges"], 1);
      assert.equal(summary["safeChanges"], 1);
      assert.equal(summary["compositionErrors"], 0);

      const changes = payload["changes"];
      assert.ok(Array.isArray(changes));
      assert.deepEqual(
        changes.map((change) => {
          assertObjectRecord(change);
          const coordinate = change["coordinate"];
          const severity = change["severity"];
          const type = change["type"];
          if (
            typeof coordinate !== "string" ||
            typeof severity !== "string" ||
            typeof type !== "string"
          ) {
            throw new TypeError("change entries must include string coordinate, severity, and type");
          }
          return `${coordinate}|${severity}|${type}`;
        }),
        [
          "Query.product|safe|FIELD_ADDED",
          "Query.products|breaking|FIELD_CHANGED_KIND",
          "SortDirection.DESC|dangerous|VALUE_ADDED_TO_ENUM",
        ],
      );
    } finally {
      await fixture.close();
    }
  });

  await t.test("returns composition errors with empty diff arrays when validation composition fails", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification,
    });

    try {
      const graph = await createGraph(fixture, graphManageToken, "catalog");
      const inventorySubgraph = await createSubgraph(
        fixture,
        graphManageToken,
        graph.slug,
        "inventory",
        "https://inventory.example.com/graphql",
      );
      await publishSubgraphSchema(fixture, createToken, graph, inventorySubgraph, baselineInventorySchemaSdl);

      const warehouseSubgraph = await createSubgraph(
        fixture,
        graphManageToken,
        graph.slug,
        "warehouse",
        "https://warehouse.example.com/graphql",
      );

      const validateToken = createSubgraphSchemaGrantToken(
        createToken,
        "subgraph_schema:validate",
        graph.id,
        warehouseSubgraph.id,
      );

      const response = await fixture.server.inject({
        headers: {
          ...authorizationHeaders(validateToken),
          "content-type": "text/plain",
        },
        method: "POST",
        payload: conflictingWarehouseSchemaSdl,
        url: `/v1/graphs/${graph.slug}/subgraphs/${warehouseSubgraph.slug}/validate-schema`,
      });

      assert.equal(response.statusCode, 200);
      const payload = parseJson(response);
      assertObjectRecord(payload);

      assert.equal(payload["composed"], false);
      assert.deepEqual(payload["changes"], []);
      const summary = payload["summary"];
      assertObjectRecord(summary);
      assert.equal(summary["totalChanges"], 0);
      assert.equal(summary["breakingChanges"], 0);
      assert.equal(summary["dangerousChanges"], 0);
      assert.equal(summary["safeChanges"], 0);
      assert.equal(summary["compositionErrors"], 1);

      const compositionErrors = payload["compositionErrors"];
      assert.ok(Array.isArray(compositionErrors));
      assert.ok(compositionErrors.length > 0);
      assert.ok(
        compositionErrors.every((error) => {
          assertObjectRecord(error);
          return typeof error["message"] === "string" && error["message"].length > 0;
        }),
      );
    } finally {
      await fixture.close();
    }
  });
});
