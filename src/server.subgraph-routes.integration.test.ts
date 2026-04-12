// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { formatStrongETag } from "./domain/etag.ts";
import {
  adminHeaders,
  adminIfMatchHeaders,
  createAdminIntegrationAuth,
  parseJson,
  withIntegrationServer,
} from "./test-support/integration-server.ts";
import { requireGraphPayload, requireSubgraphPayload } from "./test-support/payloads.ts";

await test("subgraph routes integration with postgres", async (t) => {
  const integrationDatabaseUrl = process.env["INTEGRATION_TEST_DATABASE_URL"]?.trim();
  if (!integrationDatabaseUrl) {
    t.skip("INTEGRATION_TEST_DATABASE_URL is not configured");
    return;
  }

  const { adminToken, createToken, jwtVerification } = createAdminIntegrationAuth();

  await t.test("supports full subgraph CRUD flow", async () => {
    await withIntegrationServer(integrationDatabaseUrl, jwtVerification, async (server) => {
      const createGraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "POST",
        payload: {
          slug: "catalog",
        },
        url: "/v1/graphs",
      });
      assert.equal(createGraphResponse.statusCode, 201);
      const createdGraph = requireGraphPayload(parseJson(createGraphResponse));

      const emptyListResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/catalog/subgraphs",
      });
      assert.equal(emptyListResponse.statusCode, 200);
      assert.deepEqual(parseJson(emptyListResponse), []);

      const createSubgraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "POST",
        payload: {
          routingUrl: "https://inventory-v1.example.com/graphql",
          slug: "inventory",
        },
        url: "/v1/graphs/catalog/subgraphs",
      });
      assert.equal(createSubgraphResponse.statusCode, 201);
      assert.equal(
        createSubgraphResponse.headers.location,
        "/v1/graphs/catalog/subgraphs/inventory",
      );

      const createdSubgraph = requireSubgraphPayload(parseJson(createSubgraphResponse));
      assert.equal(createdSubgraph.graphId, createdGraph.id);
      assert.equal(createdSubgraph.currentRevision, "1");
      assert.equal(createdSubgraph.routingUrl, "https://inventory-v1.example.com/graphql");
      assert.equal(createSubgraphResponse.headers.etag, formatStrongETag(createdSubgraph.id, 1));

      const duplicateCreateResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "POST",
        payload: {
          routingUrl: "https://inventory-v2.example.com/graphql",
          slug: "inventory",
        },
        url: "/v1/graphs/catalog/subgraphs",
      });
      assert.equal(duplicateCreateResponse.statusCode, 409);

      const getSubgraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.equal(getSubgraphResponse.statusCode, 200);
      assert.equal(getSubgraphResponse.headers.etag, formatStrongETag(createdSubgraph.id, 1));
      assert.deepEqual(parseJson(getSubgraphResponse), createdSubgraph);

      const updateSubgraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "PUT",
        payload: {
          routingUrl: "https://inventory-v2.example.com/graphql",
        },
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.equal(updateSubgraphResponse.statusCode, 200);

      const updatedSubgraph = requireSubgraphPayload(parseJson(updateSubgraphResponse));
      assert.equal(updatedSubgraph.id, createdSubgraph.id);
      assert.equal(updatedSubgraph.graphId, createdSubgraph.graphId);
      assert.equal(updatedSubgraph.currentRevision, "2");
      assert.equal(updatedSubgraph.routingUrl, "https://inventory-v2.example.com/graphql");
      assert.equal(updateSubgraphResponse.headers.etag, formatStrongETag(updatedSubgraph.id, 2));

      const noOpUpdateResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, formatStrongETag(updatedSubgraph.id, 2)),
        method: "PUT",
        payload: {
          routingUrl: "https://inventory-v2.example.com/graphql",
        },
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.equal(noOpUpdateResponse.statusCode, 200);
      assert.equal(noOpUpdateResponse.headers.etag, formatStrongETag(updatedSubgraph.id, 2));
      assert.deepEqual(parseJson(noOpUpdateResponse), updatedSubgraph);

      const staleUpdateResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, formatStrongETag(createdSubgraph.id, 1)),
        method: "PUT",
        payload: {
          routingUrl: "https://inventory-stale.example.com/graphql",
        },
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.equal(staleUpdateResponse.statusCode, 412);

      const staleDeleteResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, formatStrongETag(createdSubgraph.id, 1)),
        method: "DELETE",
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.equal(staleDeleteResponse.statusCode, 412);

      const deleteSubgraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "DELETE",
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.equal(deleteSubgraphResponse.statusCode, 204);

      const deletedGetResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.equal(deletedGetResponse.statusCode, 404);

      const deletedListResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/catalog/subgraphs",
      });
      assert.equal(deletedListResponse.statusCode, 200);
      assert.deepEqual(parseJson(deletedListResponse), []);

      const missingDeleteResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "DELETE",
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.equal(missingDeleteResponse.statusCode, 204);

      const recreateSubgraphResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, formatStrongETag(createdGraph.id, 1)),
        method: "POST",
        payload: {
          routingUrl: "https://inventory-v3.example.com/graphql",
          slug: "inventory",
        },
        url: "/v1/graphs/catalog/subgraphs",
      });
      assert.equal(recreateSubgraphResponse.statusCode, 201);
      const recreatedSubgraph = requireSubgraphPayload(parseJson(recreateSubgraphResponse));
      assert.notEqual(recreatedSubgraph.id, createdSubgraph.id);
      assert.equal(recreatedSubgraph.currentRevision, "1");
      assert.equal(
        recreateSubgraphResponse.headers.etag,
        formatStrongETag(recreatedSubgraph.id, 1),
      );

      const staleRecreatedUpdateResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, formatStrongETag(createdSubgraph.id, 1)),
        method: "PUT",
        payload: {
          routingUrl: "https://inventory-v4.example.com/graphql",
        },
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.equal(staleRecreatedUpdateResponse.statusCode, 412);

      const staleRecreatedDeleteResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, formatStrongETag(createdSubgraph.id, 1)),
        method: "DELETE",
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.equal(staleRecreatedDeleteResponse.statusCode, 412);
    });
  });

  await t.test("returns expected statuses when the parent graph is missing", async () => {
    await withIntegrationServer(integrationDatabaseUrl, jwtVerification, async (server) => {
      const listResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/missing/subgraphs",
      });
      assert.equal(listResponse.statusCode, 404);

      const createResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "POST",
        payload: {
          routingUrl: "https://inventory.example.com/graphql",
          slug: "inventory",
        },
        url: "/v1/graphs/missing/subgraphs",
      });
      assert.equal(createResponse.statusCode, 404);

      const staleCreateResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, formatStrongETag("graph-1", 1)),
        method: "POST",
        payload: {
          routingUrl: "https://inventory.example.com/graphql",
          slug: "inventory",
        },
        url: "/v1/graphs/missing/subgraphs",
      });
      assert.equal(staleCreateResponse.statusCode, 412);

      const getResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "GET",
        url: "/v1/graphs/missing/subgraphs/inventory",
      });
      assert.equal(getResponse.statusCode, 404);

      const unconditionalUpdateResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "PUT",
        payload: {
          routingUrl: "https://inventory.example.com/graphql",
        },
        url: "/v1/graphs/missing/subgraphs/inventory",
      });
      assert.equal(unconditionalUpdateResponse.statusCode, 404);

      const updateResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, formatStrongETag("subgraph-1", 1)),
        method: "PUT",
        payload: {
          routingUrl: "https://inventory.example.com/graphql",
        },
        url: "/v1/graphs/missing/subgraphs/inventory",
      });
      assert.equal(updateResponse.statusCode, 412);

      const deleteResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, formatStrongETag("subgraph-1", 1)),
        method: "DELETE",
        url: "/v1/graphs/missing/subgraphs/inventory",
      });
      assert.equal(deleteResponse.statusCode, 412);

      const idempotentDeleteResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "DELETE",
        url: "/v1/graphs/missing/subgraphs/inventory",
      });
      assert.equal(idempotentDeleteResponse.statusCode, 204);
    });
  });

  await t.test("returns expected statuses when the subgraph is missing", async () => {
    await withIntegrationServer(integrationDatabaseUrl, jwtVerification, async (server) => {
      const createGraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "POST",
        payload: {
          slug: "catalog",
        },
        url: "/v1/graphs",
      });
      assert.equal(createGraphResponse.statusCode, 201);

      const missingUpdateResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "PUT",
        payload: {
          routingUrl: "https://inventory.example.com/graphql",
        },
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.equal(missingUpdateResponse.statusCode, 404);

      const staleMissingUpdateResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, formatStrongETag("subgraph-1", 1)),
        method: "PUT",
        payload: {
          routingUrl: "https://inventory.example.com/graphql",
        },
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.equal(staleMissingUpdateResponse.statusCode, 412);
    });
  });

  await t.test("returns 400 for invalid if-match headers", async () => {
    await withIntegrationServer(integrationDatabaseUrl, jwtVerification, async (server) => {
      const createGraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "POST",
        payload: {
          slug: "catalog",
        },
        url: "/v1/graphs",
      });
      assert.equal(createGraphResponse.statusCode, 201);
      requireGraphPayload(parseJson(createGraphResponse));

      const invalidCreateSubgraphResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, "invalid-etag"),
        method: "POST",
        payload: {
          routingUrl: "https://inventory-v1.example.com/graphql",
          slug: "inventory",
        },
        url: "/v1/graphs/catalog/subgraphs",
      });
      assert.equal(invalidCreateSubgraphResponse.statusCode, 400);

      const validCreateSubgraphResponse = await server.inject({
        headers: adminHeaders(adminToken),
        method: "POST",
        payload: {
          routingUrl: "https://inventory-v1.example.com/graphql",
          slug: "inventory",
        },
        url: "/v1/graphs/catalog/subgraphs",
      });
      assert.equal(validCreateSubgraphResponse.statusCode, 201);

      const invalidUpdateResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, "invalid-etag"),
        method: "PUT",
        payload: {
          routingUrl: "https://inventory-v2.example.com/graphql",
        },
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.equal(invalidUpdateResponse.statusCode, 400);

      const invalidDeleteResponse = await server.inject({
        headers: adminIfMatchHeaders(adminToken, "invalid-etag"),
        method: "DELETE",
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.equal(invalidDeleteResponse.statusCode, 400);
    });
  });

  await t.test(
    "returns 403 for unauthorized graph:manage users before evaluating If-Match on existing graphs",
    async () => {
      await withIntegrationServer(integrationDatabaseUrl, jwtVerification, async (server) => {
        const createGraphResponse = await server.inject({
          headers: adminHeaders(adminToken),
          method: "POST",
          payload: {
            slug: "catalog",
          },
          url: "/v1/graphs",
        });
        assert.equal(createGraphResponse.statusCode, 201);
        const createdGraph = requireGraphPayload(parseJson(createGraphResponse));

        const unauthorizedManageToken = createToken({
          authorization_details: [
            {
              graph_id: "unmanaged-graph-id",
              scope: "graph:manage",
              type: authorizationDetailsType,
            },
          ],
        });

        const createSubgraphResponse = await server.inject({
          headers: adminIfMatchHeaders(
            unauthorizedManageToken,
            formatStrongETag(createdGraph.id, 2),
          ),
          method: "POST",
          payload: {
            routingUrl: "https://inventory.example.com/graphql",
            slug: "inventory",
          },
          url: "/v1/graphs/catalog/subgraphs",
        });
        assert.equal(createSubgraphResponse.statusCode, 403);
      });
    },
  );
});
