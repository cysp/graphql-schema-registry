// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { formatStrongETag } from "./domain/etag.ts";
import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import {
  adminHeaders,
  adminIfMatchHeaders,
  authorizationHeaders,
  parseJson,
  withIntegrationServer,
} from "./test-support/integration-server.ts";
import { requireGraphPayload, requireSubgraphPayload } from "./test-support/payloads.ts";

const validSubgraphSdl = `extend schema @link(url: "https://specs.apollo.dev/federation/v2.9")

type Query {
  products: [String!]!
}
`;

const invalidDryRunSdl = `extend schema @link(url: "https://specs.apollo.dev/federation/v2.9")

type Product {
  id: ID!
}
`;

await test("supergraph SDL routes integration with postgres", async (t) => {
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
  const jwtVerification = jwtSigner.jwtVerification;

  async function createGraphAndSubgraph(
    server: Parameters<typeof withIntegrationServer>[2] extends (server: infer T) => Promise<void>
      ? T
      : never,
  ): Promise<{ graphEtag: string; schemaWriteToken: string; subgraphEtag: string }> {
    const createGraphResponse = await server.inject({
      headers: adminHeaders(adminToken),
      method: "POST",
      payload: {
        federationVersion: "v2.9",
        slug: "catalog",
      },
      url: "/v1/graphs",
    });
    assert.equal(createGraphResponse.statusCode, 201);
    const graph = requireGraphPayload(parseJson(createGraphResponse));

    const createSubgraphResponse = await server.inject({
      headers: adminHeaders(adminToken),
      method: "POST",
      payload: {
        routingUrl: "https://inventory.example.com/graphql",
        slug: "inventory",
      },
      url: "/v1/graphs/catalog/subgraphs",
    });
    assert.equal(createSubgraphResponse.statusCode, 201);
    const subgraph = requireSubgraphPayload(parseJson(createSubgraphResponse));

    return {
      graphEtag: formatStrongETag(graph.id, 1),
      schemaWriteToken: jwtSigner.createToken({
        authorization_details: [
          {
            graph_id: graph.id,
            scope: "subgraph-schema:write",
            subgraph_id: subgraph.id,
            type: authorizationDetailsType,
          },
        ],
      }),
      subgraphEtag: formatStrongETag(subgraph.id, 1),
    };
  }

  await t.test("returns the current supergraph SDL and clears it after deletion", async () => {
    await withIntegrationServer(integrationDatabaseUrl, jwtVerification, async (server) => {
      const { schemaWriteToken, subgraphEtag } = await createGraphAndSubgraph(server);

      const publishResponse = await server.inject({
        headers: {
          ...authorizationHeaders(schemaWriteToken),
          "content-type": "text/plain",
        },
        method: "POST",
        payload: validSubgraphSdl,
        url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
      });
      assert.equal(publishResponse.statusCode, 204);
      assert.equal(publishResponse.body, "");
      assert.equal(publishResponse.headers.etag, subgraphEtag);

      const getSupergraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/catalog/supergraph.graphqls",
      });
      assert.equal(getSupergraphResponse.statusCode, 200);
      assert.match(String(getSupergraphResponse.headers["content-type"]), /^text\/plain\b/);
      assert.equal(getSupergraphResponse.headers["cache-control"], "private, must-revalidate");
      assert.match(getSupergraphResponse.body, /products/);

      const etag = String(getSupergraphResponse.headers.etag);
      const notModifiedResponse = await server.inject({
        headers: {
          ...adminHeaders(adminToken),
          "if-none-match": `"other-etag", ${etag}`,
        },
        method: "GET",
        url: "/v1/graphs/catalog/supergraph.graphqls",
      });
      assert.equal(notModifiedResponse.statusCode, 304);
      assert.equal(notModifiedResponse.headers.etag, etag);
      assert.equal(notModifiedResponse.headers["cache-control"], "private, must-revalidate");

      const deleteSubgraphResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, subgraphEtag),
        method: "DELETE",
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.equal(deleteSubgraphResponse.statusCode, 204);

      const missingSupergraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/catalog/supergraph.graphqls",
      });
      assert.equal(missingSupergraphResponse.statusCode, 404);
    });
  });

  await t.test(
    "does not rotate the supergraph etag on no-op graph and subgraph updates",
    async () => {
      await withIntegrationServer(integrationDatabaseUrl, jwtVerification, async (server) => {
        const { graphEtag, schemaWriteToken, subgraphEtag } = await createGraphAndSubgraph(server);

        const publishResponse = await server.inject({
          headers: {
            ...authorizationHeaders(schemaWriteToken),
            "content-type": "text/plain",
          },
          method: "POST",
          payload: validSubgraphSdl,
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(publishResponse.statusCode, 204);

        const initialSupergraphResponse = await server.inject({
          headers: adminHeaders(adminToken),
          method: "GET",
          url: "/v1/graphs/catalog/supergraph.graphqls",
        });
        assert.equal(initialSupergraphResponse.statusCode, 200);
        const initialSupergraphEtag = String(initialSupergraphResponse.headers.etag);

        const noOpGraphUpdateResponse = await server.inject({
          headers: adminIfMatchHeaders(adminToken, graphEtag),
          method: "PUT",
          payload: {
            federationVersion: "v2.9",
          },
          url: "/v1/graphs/catalog",
        });
        assert.equal(noOpGraphUpdateResponse.statusCode, 200);

        const noOpSubgraphUpdateResponse = await server.inject({
          headers: adminIfMatchHeaders(adminToken, subgraphEtag),
          method: "PUT",
          payload: {
            routingUrl: "https://inventory.example.com/graphql",
          },
          url: "/v1/graphs/catalog/subgraphs/inventory",
        });
        assert.equal(noOpSubgraphUpdateResponse.statusCode, 200);

        const finalSupergraphResponse = await server.inject({
          headers: adminHeaders(adminToken),
          method: "GET",
          url: "/v1/graphs/catalog/supergraph.graphqls",
        });
        assert.equal(finalSupergraphResponse.statusCode, 200);
        assert.equal(finalSupergraphResponse.headers.etag, initialSupergraphEtag);
      });
    },
  );

  await t.test("validates candidate schemas on the dedicated endpoint", async () => {
    await withIntegrationServer(integrationDatabaseUrl, jwtVerification, async (server) => {
      await createGraphAndSubgraph(server);

      const validResponse = await server.inject({
        headers: {
          ...adminHeaders(adminToken),
          "content-type": "text/plain",
        },
        method: "POST",
        payload: validSubgraphSdl,
        url: "/v1/graphs/catalog/subgraphs/inventory/validate-schema",
      });
      assert.equal(validResponse.statusCode, 200);
      assert.deepEqual(parseJson(validResponse), {
        diagnostics: [],
      });

      const invalidResponse = await server.inject({
        headers: {
          ...adminHeaders(adminToken),
          "content-type": "text/plain",
        },
        method: "POST",
        payload: invalidDryRunSdl,
        url: "/v1/graphs/catalog/subgraphs/inventory/validate-schema",
      });
      assert.equal(invalidResponse.statusCode, 422);
      assert.match(
        String(invalidResponse.headers["content-type"]),
        /^application\/problem\+json\b/,
      );
      assert.deepEqual(parseJson(invalidResponse), {
        type: "about:blank",
        status: 422,
        title: "Unprocessable Entity",
        diagnostics: [
          "No queries found in any subgraph: a supergraph must have a query root type.",
        ],
      });
    });
  });
});
