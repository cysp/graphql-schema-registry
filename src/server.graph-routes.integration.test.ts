// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import test from "node:test";

import { formatStrongETag } from "./domain/etag.ts";
import {
  adminHeaders,
  adminIfMatchHeaders,
  createAdminIntegrationAuth,
  parseJson,
  withIntegrationServer,
} from "./test-support/integration-server.ts";
import { requireGraphPayload } from "./test-support/payloads.ts";

await test("graph routes integration with postgres", async (t) => {
  const integrationDatabaseUrl = process.env["INTEGRATION_TEST_DATABASE_URL"]?.trim();
  if (!integrationDatabaseUrl) {
    t.skip("INTEGRATION_TEST_DATABASE_URL is not configured");
    return;
  }

  const { adminToken, jwtVerification } = createAdminIntegrationAuth();

  await t.test("supports full graph CRUD flow", async () => {
    await withIntegrationServer(integrationDatabaseUrl, jwtVerification, async (server) => {
      const emptyListResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs",
      });
      assert.equal(emptyListResponse.statusCode, 200);
      assert.deepEqual(parseJson(emptyListResponse), []);

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
      assert.equal(createGraphResponse.headers.location, "/v1/graphs/catalog");

      const createdGraph = requireGraphPayload(parseJson(createGraphResponse));
      assert.equal(createdGraph.slug, "catalog");
      assert.equal(createdGraph.federationVersion, "v2.9");
      assert.equal(createdGraph.currentRevision, "1");
      assert.equal(createGraphResponse.headers.etag, formatStrongETag(createdGraph.id, 1));

      const duplicateCreateResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "POST",
        payload: {
          federationVersion: "v2.10",
          slug: "catalog",
        },
        url: "/v1/graphs",
      });
      assert.equal(duplicateCreateResponse.statusCode, 409);

      const getGraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/catalog",
      });
      assert.equal(getGraphResponse.statusCode, 200);
      assert.equal(getGraphResponse.headers.etag, formatStrongETag(createdGraph.id, 1));
      assert.deepEqual(parseJson(getGraphResponse), createdGraph);

      const updateGraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "PUT",
        payload: {
          federationVersion: "v2.10",
        },
        url: "/v1/graphs/catalog",
      });
      assert.equal(updateGraphResponse.statusCode, 200);

      const updatedGraph = requireGraphPayload(parseJson(updateGraphResponse));
      assert.equal(updatedGraph.id, createdGraph.id);
      assert.equal(updatedGraph.slug, createdGraph.slug);
      assert.equal(updatedGraph.federationVersion, "v2.10");
      assert.equal(updatedGraph.currentRevision, "2");
      assert.equal(updateGraphResponse.headers.etag, formatStrongETag(updatedGraph.id, 2));

      const noOpUpdateResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, formatStrongETag(updatedGraph.id, 2)),
        method: "PUT",
        payload: {
          federationVersion: "v2.10",
        },
        url: "/v1/graphs/catalog",
      });
      assert.equal(noOpUpdateResponse.statusCode, 200);
      assert.equal(noOpUpdateResponse.headers.etag, formatStrongETag(updatedGraph.id, 2));
      assert.deepEqual(parseJson(noOpUpdateResponse), updatedGraph);

      const staleUpdateResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, formatStrongETag(createdGraph.id, 1)),
        method: "PUT",
        payload: {
          federationVersion: "v2.11",
        },
        url: "/v1/graphs/catalog",
      });
      assert.equal(staleUpdateResponse.statusCode, 412);

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

      const staleDeleteResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, formatStrongETag(createdGraph.id, 1)),
        method: "DELETE",
        url: "/v1/graphs/catalog",
      });
      assert.equal(staleDeleteResponse.statusCode, 412);

      const deleteGraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "DELETE",
        url: "/v1/graphs/catalog",
      });
      assert.equal(deleteGraphResponse.statusCode, 204);

      const deletedGetResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/catalog",
      });
      assert.equal(deletedGetResponse.statusCode, 404);

      const deletedListResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs",
      });
      assert.equal(deletedListResponse.statusCode, 200);
      assert.deepEqual(parseJson(deletedListResponse), []);

      const subgraphGetAfterGraphDelete = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.equal(subgraphGetAfterGraphDelete.statusCode, 404);

      const subgraphListAfterGraphDelete = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/catalog/subgraphs",
      });
      assert.equal(subgraphListAfterGraphDelete.statusCode, 404);

      const missingDeleteResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "DELETE",
        url: "/v1/graphs/catalog",
      });
      assert.equal(missingDeleteResponse.statusCode, 204);

      const recreateGraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "POST",
        payload: {
          federationVersion: "v2.12",
          slug: "catalog",
        },
        url: "/v1/graphs",
      });
      assert.equal(recreateGraphResponse.statusCode, 201);
      const recreatedGraph = requireGraphPayload(parseJson(recreateGraphResponse));
      assert.notEqual(recreatedGraph.id, createdGraph.id);
      assert.equal(recreatedGraph.currentRevision, "1");
      assert.equal(recreateGraphResponse.headers.etag, formatStrongETag(recreatedGraph.id, 1));

      const staleRecreatedUpdateResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, formatStrongETag(createdGraph.id, 1)),
        method: "PUT",
        payload: {
          federationVersion: "v2.13",
        },
        url: "/v1/graphs/catalog",
      });
      assert.equal(staleRecreatedUpdateResponse.statusCode, 412);

      const staleRecreatedDeleteResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, formatStrongETag(createdGraph.id, 1)),
        method: "DELETE",
        url: "/v1/graphs/catalog",
      });
      assert.equal(staleRecreatedDeleteResponse.statusCode, 412);

      const staleRecreatedSubgraphCreateResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, formatStrongETag(createdGraph.id, 1)),
        method: "POST",
        payload: {
          routingUrl: "https://inventory-recreated.example.com/graphql",
          slug: "inventory",
        },
        url: "/v1/graphs/catalog/subgraphs",
      });
      assert.equal(staleRecreatedSubgraphCreateResponse.statusCode, 412);

      const recreatedSubgraphCreateResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, formatStrongETag(recreatedGraph.id, 1)),
        method: "POST",
        payload: {
          routingUrl: "https://inventory-recreated.example.com/graphql",
          slug: "inventory",
        },
        url: "/v1/graphs/catalog/subgraphs",
      });
      assert.equal(recreatedSubgraphCreateResponse.statusCode, 201);
    });
  });

  await t.test("returns 404 for missing reads and 412 for missing conditional writes", async () => {
    await withIntegrationServer(integrationDatabaseUrl, jwtVerification, async (server) => {
      const getResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/missing",
      });
      assert.equal(getResponse.statusCode, 404);

      const unconditionalUpdateResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "PUT",
        payload: {
          federationVersion: "v2.10",
        },
        url: "/v1/graphs/missing",
      });
      assert.equal(unconditionalUpdateResponse.statusCode, 404);

      const updateResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, formatStrongETag("graph-1", 1)),
        method: "PUT",
        payload: {
          federationVersion: "v2.10",
        },
        url: "/v1/graphs/missing",
      });
      assert.equal(updateResponse.statusCode, 412);

      const deleteResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, formatStrongETag("graph-1", 1)),
        method: "DELETE",
        url: "/v1/graphs/missing",
      });
      assert.equal(deleteResponse.statusCode, 412);

      const idempotentDeleteResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "DELETE",
        url: "/v1/graphs/missing",
      });
      assert.equal(idempotentDeleteResponse.statusCode, 204);
    });
  });

  await t.test("returns 400 for invalid if-match headers", async () => {
    await withIntegrationServer(integrationDatabaseUrl, jwtVerification, async (server) => {
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

      const invalidUpdateResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, "invalid-etag"),
        method: "PUT",
        payload: {
          federationVersion: "v2.10",
        },
        url: "/v1/graphs/catalog",
      });
      assert.equal(invalidUpdateResponse.statusCode, 400);

      const invalidDeleteResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, "invalid-etag"),
        method: "DELETE",
        url: "/v1/graphs/catalog",
      });
      assert.equal(invalidDeleteResponse.statusCode, 400);
    });
  });
});
