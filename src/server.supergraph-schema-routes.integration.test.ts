// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { formatStrongETag } from "./domain/etag.ts";
import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import {
  adminHeaders,
  authorizationHeaders,
  parseJson,
  createIntegrationServerFixture,
} from "./test-support/integration-server.ts";
import { requireGraphPayload, requireSubgraphPayload } from "./test-support/payloads.ts";

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

type IntegrationFixture = Awaited<ReturnType<typeof createIntegrationServerFixture>>;

function createGraphReadGrantToken(
  createToken: ReturnType<typeof createAuthJwtSigner>["createToken"],
  graphId: string,
): string {
  return createToken({
    authorization_details: [
      {
        graph_id: graphId,
        scope: "graph:read",
        type: authorizationDetailsType,
      },
    ],
  });
}

function createSubgraphSchemaGrantToken(
  createToken: ReturnType<typeof createAuthJwtSigner>["createToken"],
  graphId: string,
  subgraphId: string,
): string {
  return createToken({
    authorization_details: [
      {
        graph_id: graphId,
        scope: "subgraph-schema:write",
        subgraph_id: subgraphId,
        type: authorizationDetailsType,
      },
    ],
  });
}

async function createGraph(
  fixture: IntegrationFixture,
  adminToken: string,
  slug: string,
): Promise<ReturnType<typeof requireGraphPayload>> {
  const response = await fixture.server.inject({
    headers: adminHeaders(adminToken),
    method: "POST",
    payload: { slug },
    url: "/v1/graphs",
  });
  assert.equal(response.statusCode, 201);
  return requireGraphPayload(parseJson(response));
}

async function createSubgraph(
  fixture: IntegrationFixture,
  adminToken: string,
  graphSlug: string,
  slug: string,
  routingUrl: string,
): Promise<ReturnType<typeof requireSubgraphPayload>> {
  const response = await fixture.server.inject({
    headers: adminHeaders(adminToken),
    method: "POST",
    payload: { routingUrl, slug },
    url: `/v1/graphs/${graphSlug}/subgraphs`,
  });
  assert.equal(response.statusCode, 201);
  return requireSubgraphPayload(parseJson(response));
}

async function publishSubgraphSchema(
  fixture: IntegrationFixture,
  createToken: ReturnType<typeof createAuthJwtSigner>["createToken"],
  graph: ReturnType<typeof requireGraphPayload>,
  subgraph: ReturnType<typeof requireSubgraphPayload>,
  schemaSdl: string,
): Promise<void> {
  const schemaWriteToken = createSubgraphSchemaGrantToken(createToken, graph.id, subgraph.id);
  const response = await fixture.server.inject({
    headers: {
      ...authorizationHeaders(schemaWriteToken),
      "content-type": "text/plain",
    },
    method: "POST",
    payload: schemaSdl,
    url: `/v1/graphs/${graph.slug}/subgraphs/${subgraph.slug}/schema.graphqls`,
  });
  assert.equal(response.statusCode, 204);
}

await test("supergraph schema routes integration with postgres", async (t) => {
  const integrationDatabaseUrl = process.env["INTEGRATION_TEST_DATABASE_URL"]?.trim();
  if (!integrationDatabaseUrl) {
    t.skip("INTEGRATION_TEST_DATABASE_URL is not configured");
    return;
  }

  const jwtSigner = createAuthJwtSigner();
  const adminToken = jwtSigner.createToken({
    authorization_details: [
      {
        scope: "admin",
        type: authorizationDetailsType,
      },
    ],
  });

  await t.test("returns 404 when no current supergraph schema exists", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification: jwtSigner.jwtVerification,
    });

    try {
      const graph = await createGraph(fixture, adminToken, "catalog");
      const graphReadToken = createGraphReadGrantToken(jwtSigner.createToken, graph.id);

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

  await t.test("returns 403 for admin users", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification: jwtSigner.jwtVerification,
    });

    try {
      const graph = await createGraph(fixture, adminToken, "catalog");
      const response = await fixture.server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: `/v1/graphs/${graph.slug}/supergraph.graphqls`,
      });

      assert.equal(response.statusCode, 403);
    } finally {
      await fixture.close();
    }
  });

  await t.test("returns 401 regardless of graph slug when unauthenticated", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification: jwtSigner.jwtVerification,
    });

    try {
      const graph = await createGraph(fixture, adminToken, "catalog");

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

  await t.test("serves the current supergraph schema to graph:read users", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification: jwtSigner.jwtVerification,
    });

    try {
      const graph = await createGraph(fixture, adminToken, "catalog");
      const subgraph = await createSubgraph(
        fixture,
        adminToken,
        graph.slug,
        "inventory",
        "https://inventory.example.com/graphql",
      );
      await publishSubgraphSchema(
        fixture,
        jwtSigner.createToken,
        graph,
        subgraph,
        inventorySchemaSdl,
      );

      const graphReadToken = createGraphReadGrantToken(jwtSigner.createToken, graph.id);
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
      jwtVerification: jwtSigner.jwtVerification,
    });

    try {
      const graph = await createGraph(fixture, adminToken, "catalog");
      const subgraph = await createSubgraph(
        fixture,
        adminToken,
        graph.slug,
        "inventory",
        "https://inventory.example.com/graphql",
      );
      await publishSubgraphSchema(
        fixture,
        jwtSigner.createToken,
        graph,
        subgraph,
        inventorySchemaSdl,
      );

      const graphReadToken = createGraphReadGrantToken(jwtSigner.createToken, graph.id);
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
      jwtVerification: jwtSigner.jwtVerification,
    });

    try {
      const graph = await createGraph(fixture, adminToken, "catalog");
      const subgraph = await createSubgraph(
        fixture,
        adminToken,
        graph.slug,
        "inventory",
        "https://inventory.example.com/graphql",
      );
      await publishSubgraphSchema(
        fixture,
        jwtSigner.createToken,
        graph,
        subgraph,
        inventorySchemaSdl,
      );

      const graphReadToken = createGraphReadGrantToken(jwtSigner.createToken, graph.id);
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
        jwtVerification: jwtSigner.jwtVerification,
      });

      try {
        const graph = await createGraph(fixture, adminToken, "catalog");
        const inventorySubgraph = await createSubgraph(
          fixture,
          adminToken,
          graph.slug,
          "inventory",
          "https://inventory.example.com/graphql",
        );
        await publishSubgraphSchema(
          fixture,
          jwtSigner.createToken,
          graph,
          inventorySubgraph,
          inventorySchemaSdl,
        );

        const warehouseSubgraph = await createSubgraph(
          fixture,
          adminToken,
          graph.slug,
          "warehouse",
          "https://warehouse.example.com/graphql",
        );
        await publishSubgraphSchema(
          fixture,
          jwtSigner.createToken,
          graph,
          warehouseSubgraph,
          conflictingProductsSchemaSdl,
        );

        const graphReadToken = createGraphReadGrantToken(jwtSigner.createToken, graph.id);
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
