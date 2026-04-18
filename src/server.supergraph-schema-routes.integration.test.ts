import assert from "node:assert/strict";
import test from "node:test";

import { formatStrongETag } from "./domain/etag.ts";
import {
  createGraph,
  createSubgraph,
  createSupergraphSchemaReadGrantToken,
  createWildcardSupergraphSchemaReadGrantToken,
  publishSubgraphSchema,
} from "./test-support/integration-scenarios.ts";
import {
  authorizationHeaders,
  createGraphManageIntegrationAuth,
  createIntegrationServerFixture,
  requireIntegrationDatabaseUrl,
} from "./test-support/integration-server.ts";

const inventorySchemaSdl = `
  type Query {
    products: [String!]!
  }
`;

const conflictingProductsSchemaSdl = `
  type Query {
    products: [Int!]!
  }
`;

await test("[integration] supergraph schema routes integration with postgres", async (t) => {
  const integrationDatabaseUrl = requireIntegrationDatabaseUrl(t);
  if (!integrationDatabaseUrl) {
    return;
  }

  const { createToken, graphManageToken, jwtVerification } = createGraphManageIntegrationAuth();

  await t.test("returns 404 when no current supergraph schema exists", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification,
    });

    try {
      const graph = await createGraph(fixture, graphManageToken, "catalog");
      const graphReadToken = createSupergraphSchemaReadGrantToken(createToken, graph.id);

      const response = await fixture.server.inject({
        headers: authorizationHeaders(graphReadToken),
        method: "GET",
        url: `/v1/graphs/${graph.slug}/supergraph.graphqls`,
      });

      assert.equal(response.statusCode, 404);

      const wildcardResponse = await fixture.server.inject({
        headers: {
          ...authorizationHeaders(graphReadToken),
          "if-none-match": "*",
        },
        method: "GET",
        url: `/v1/graphs/${graph.slug}/supergraph.graphqls`,
      });

      assert.equal(wildcardResponse.statusCode, 404);
    } finally {
      await fixture.close();
    }
  });

  await t.test("returns 403 for graph:manage users", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification,
    });

    try {
      const graph = await createGraph(fixture, graphManageToken, "catalog");
      const response = await fixture.server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "GET",
        url: `/v1/graphs/${graph.slug}/supergraph.graphqls`,
      });

      assert.equal(response.statusCode, 403);
    } finally {
      await fixture.close();
    }
  });

  await t.test(
    "returns 403 for scoped supergraph_schema:read users when graph slugs are hidden or missing",
    async () => {
      const fixture = await createIntegrationServerFixture({
        databaseUrl: integrationDatabaseUrl,
        jwtVerification,
      });

      try {
        const visibleGraph = await createGraph(fixture, graphManageToken, "catalog");
        const hiddenGraph = await createGraph(fixture, graphManageToken, "reviews");
        const visibleGraphReadToken = createSupergraphSchemaReadGrantToken(
          createToken,
          visibleGraph.id,
        );

        const hiddenGraphResponse = await fixture.server.inject({
          headers: authorizationHeaders(visibleGraphReadToken),
          method: "GET",
          url: `/v1/graphs/${hiddenGraph.slug}/supergraph.graphqls`,
        });
        assert.equal(hiddenGraphResponse.statusCode, 403);

        const missingGraphResponse = await fixture.server.inject({
          headers: authorizationHeaders(visibleGraphReadToken),
          method: "GET",
          url: "/v1/graphs/missing-graph/supergraph.graphqls",
        });
        assert.equal(missingGraphResponse.statusCode, 403);
      } finally {
        await fixture.close();
      }
    },
  );

  await t.test(
    "returns 404 for wildcard supergraph_schema:read users when graph is missing",
    async () => {
      const fixture = await createIntegrationServerFixture({
        databaseUrl: integrationDatabaseUrl,
        jwtVerification,
      });

      try {
        const wildcardGraphReadToken = createWildcardSupergraphSchemaReadGrantToken(createToken);
        const response = await fixture.server.inject({
          headers: authorizationHeaders(wildcardGraphReadToken),
          method: "GET",
          url: "/v1/graphs/missing-graph/supergraph.graphqls",
        });

        assert.equal(response.statusCode, 404);
      } finally {
        await fixture.close();
      }
    },
  );

  await t.test("returns 401 regardless of graph slug when unauthenticated", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification,
    });

    try {
      const graph = await createGraph(fixture, graphManageToken, "catalog");

      const existingGraphResponse = await fixture.server.inject({
        method: "GET",
        url: `/v1/graphs/${graph.slug}/supergraph.graphqls`,
      });
      assert.equal(existingGraphResponse.statusCode, 401);

      const missingGraphResponse = await fixture.server.inject({
        method: "GET",
        url: "/v1/graphs/missing-graph/supergraph.graphqls",
      });
      assert.equal(missingGraphResponse.statusCode, 401);
    } finally {
      await fixture.close();
    }
  });

  await t.test("serves the current supergraph schema to supergraph_schema:read users", async () => {
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
      await publishSubgraphSchema(fixture, createToken, graph, subgraph, inventorySchemaSdl);

      const graphReadToken = createSupergraphSchemaReadGrantToken(createToken, graph.id);
      const response = await fixture.server.inject({
        headers: authorizationHeaders(graphReadToken),
        method: "GET",
        url: `/v1/graphs/${graph.slug}/supergraph.graphqls`,
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.headers["content-type"], "text/plain; charset=utf-8");
      assert.equal(response.headers.etag, formatStrongETag(graph.id, 1));
      assert.match(response.body, /join__Graph/);
      assert.match(response.body, /inventory\.example\.com\/graphql/);
    } finally {
      await fixture.close();
    }
  });

  await t.test("returns 304 for exact, weak, and wildcard If-None-Match matches", async () => {
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
      await publishSubgraphSchema(fixture, createToken, graph, subgraph, inventorySchemaSdl);

      const graphReadToken = createSupergraphSchemaReadGrantToken(createToken, graph.id);
      const currentEtag = formatStrongETag(graph.id, 1);

      for (const ifNoneMatch of [currentEtag, `W/${currentEtag}`, "*"]) {
        const response = await fixture.server.inject({
          headers: {
            ...authorizationHeaders(graphReadToken),
            "if-none-match": ifNoneMatch,
          },
          method: "GET",
          url: `/v1/graphs/${graph.slug}/supergraph.graphqls`,
        });

        assert.equal(response.statusCode, 304);
        assert.equal(response.body, "");
        assert.equal(response.headers.etag, currentEtag);
      }
    } finally {
      await fixture.close();
    }
  });

  await t.test("returns 400 for an invalid If-None-Match header", async () => {
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
      await publishSubgraphSchema(fixture, createToken, graph, subgraph, inventorySchemaSdl);

      const graphReadToken = createSupergraphSchemaReadGrantToken(createToken, graph.id);
      const response = await fixture.server.inject({
        headers: {
          ...authorizationHeaders(graphReadToken),
          "if-none-match": "invalid-etag",
        },
        method: "GET",
        url: `/v1/graphs/${graph.slug}/supergraph.graphqls`,
      });

      assert.equal(response.statusCode, 400);
    } finally {
      await fixture.close();
    }
  });

  await t.test(
    "keeps serving the last successful supergraph after a failed recomposition",
    async () => {
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
        await publishSubgraphSchema(
          fixture,
          createToken,
          graph,
          inventorySubgraph,
          inventorySchemaSdl,
        );

        const warehouseSubgraph = await createSubgraph(
          fixture,
          graphManageToken,
          graph.slug,
          "warehouse",
          "https://warehouse.example.com/graphql",
        );
        await publishSubgraphSchema(
          fixture,
          createToken,
          graph,
          warehouseSubgraph,
          conflictingProductsSchemaSdl,
        );

        const graphReadToken = createSupergraphSchemaReadGrantToken(createToken, graph.id);
        const response = await fixture.server.inject({
          headers: authorizationHeaders(graphReadToken),
          method: "GET",
          url: `/v1/graphs/${graph.slug}/supergraph.graphqls`,
        });

        assert.equal(response.statusCode, 200);
        assert.equal(response.headers.etag, formatStrongETag(graph.id, 1));
        assert.match(response.body, /inventory\.example\.com\/graphql/);
        assert.doesNotMatch(response.body, /warehouse\.example\.com\/graphql/);
      } finally {
        await fixture.close();
      }
    },
  );
});
