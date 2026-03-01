// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import { zGraphRoot, zSubgraphListRoot, zSubgraphRoot } from "./lib/openapi-ts/zod.gen.ts";
import { createFastifyServer } from "./server.ts";
import { connectIntegrationDatabase } from "./test-support/database.ts";

function parseJson(response: { body: string }): unknown {
  return JSON.parse(response.body) as unknown;
}

function adminHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
  };
}

function adminRevisionHeaders(token: string, revisionId: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "x-revision-id": revisionId,
  };
}

await test("subgraph routes integration with postgres", async (t) => {
  const integrationDatabaseUrlFromEnv = process.env["INTEGRATION_TEST_DATABASE_URL"]?.trim();
  if (integrationDatabaseUrlFromEnv === undefined || integrationDatabaseUrlFromEnv === "") {
    t.skip("INTEGRATION_TEST_DATABASE_URL is not configured");
    return;
  }
  const integrationDatabaseUrl = integrationDatabaseUrlFromEnv;

  const jwtSigner = createAuthJwtSigner();
  const adminToken = jwtSigner.createToken({
    authorization_details: [
      {
        scope: "admin",
        type: authorizationDetailsType,
      },
    ],
  });

  await t.test("supports full subgraph CRUD flow", async () => {
    const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);
    const server = createFastifyServer({
      database: integrationDatabase.database.database,
      jwtVerification: jwtSigner.jwtVerification,
    });

    try {
      await server.ready();

      const createGraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "POST",
        payload: { federationVersion: "2.9", graphSlug: "catalog" },
        url: "/v1/graphs",
      });
      assert.strictEqual(createGraphResponse.statusCode, 201);
      const createdGraph = zGraphRoot.parse(parseJson(createGraphResponse));

      const emptyListResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/catalog/subgraphs",
      });
      assert.strictEqual(emptyListResponse.statusCode, 200);
      assert.deepStrictEqual(zSubgraphListRoot.parse(parseJson(emptyListResponse)), []);

      const createSubgraphResponse = await server.inject({
        headers: adminRevisionHeaders(adminToken, "1"),
        method: "PUT",
        payload: { routingUrl: "https://inventory-v1.example.com/graphql" },
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.strictEqual(createSubgraphResponse.statusCode, 201);
      const createdSubgraph = zSubgraphRoot.parse(parseJson(createSubgraphResponse));
      assert.strictEqual(createdSubgraph.graphId, createdGraph.id);
      assert.strictEqual(createdSubgraph.revisionId, "1");
      assert.strictEqual(createdSubgraph.routingUrl, "https://inventory-v1.example.com/graphql");

      const getSubgraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.strictEqual(getSubgraphResponse.statusCode, 200);
      assert.deepStrictEqual(zSubgraphRoot.parse(parseJson(getSubgraphResponse)), createdSubgraph);

      const updateSubgraphResponse = await server.inject({
        headers: adminRevisionHeaders(adminToken, "1"),
        method: "PUT",
        payload: { routingUrl: "https://inventory-v2.example.com/graphql" },
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.strictEqual(updateSubgraphResponse.statusCode, 200);
      const updatedSubgraph = zSubgraphRoot.parse(parseJson(updateSubgraphResponse));
      assert.strictEqual(updatedSubgraph.id, createdSubgraph.id);
      assert.strictEqual(updatedSubgraph.revisionId, "2");
      assert.strictEqual(updatedSubgraph.routingUrl, "https://inventory-v2.example.com/graphql");

      const staleUpdateResponse = await server.inject({
        headers: adminRevisionHeaders(adminToken, "1"),
        method: "PUT",
        payload: { routingUrl: "https://inventory-stale.example.com/graphql" },
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.strictEqual(staleUpdateResponse.statusCode, 409);

      const nonNumericRevisionResponse = await server.inject({
        headers: adminRevisionHeaders(adminToken, "not-a-number"),
        method: "PUT",
        payload: { routingUrl: "https://inventory-invalid.example.com/graphql" },
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.strictEqual(nonNumericRevisionResponse.statusCode, 400);

      const missingRevisionHeaderResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "PUT",
        payload: { routingUrl: "https://inventory-missing-header.example.com/graphql" },
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.strictEqual(missingRevisionHeaderResponse.statusCode, 400);

      const invalidCreateRevisionResponse = await server.inject({
        headers: adminRevisionHeaders(adminToken, "2"),
        method: "PUT",
        payload: { routingUrl: "https://orders-v1.example.com/graphql" },
        url: "/v1/graphs/catalog/subgraphs/orders",
      });
      assert.strictEqual(invalidCreateRevisionResponse.statusCode, 422);

      const deleteSubgraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "DELETE",
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.strictEqual(deleteSubgraphResponse.statusCode, 204);

      const deletedGetResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.strictEqual(deletedGetResponse.statusCode, 404);

      const deletedListResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/catalog/subgraphs",
      });
      assert.strictEqual(deletedListResponse.statusCode, 200);
      assert.deepStrictEqual(zSubgraphListRoot.parse(parseJson(deletedListResponse)), []);

      const missingDeleteResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "DELETE",
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.strictEqual(missingDeleteResponse.statusCode, 404);
    } finally {
      await server.close();
      await integrationDatabase.close();
    }
  });

  await t.test("returns 404 when graph is missing", async () => {
    const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);
    const server = createFastifyServer({
      database: integrationDatabase.database.database,
      jwtVerification: jwtSigner.jwtVerification,
    });

    try {
      await server.ready();

      const listResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/missing/subgraphs",
      });
      assert.strictEqual(listResponse.statusCode, 404);

      const getResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/missing/subgraphs/inventory",
      });
      assert.strictEqual(getResponse.statusCode, 404);

      const upsertResponse = await server.inject({
        headers: adminRevisionHeaders(adminToken, "1"),
        method: "PUT",
        payload: { routingUrl: "https://inventory.example.com/graphql" },
        url: "/v1/graphs/missing/subgraphs/inventory",
      });
      assert.strictEqual(upsertResponse.statusCode, 404);

      const deleteResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "DELETE",
        url: "/v1/graphs/missing/subgraphs/inventory",
      });
      assert.strictEqual(deleteResponse.statusCode, 404);
    } finally {
      await server.close();
      await integrationDatabase.close();
    }
  });
});
