// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { formatStrongETag } from "./domain/etag.ts";
import {
  authorizationHeaders,
  authorizationIfMatchHeaders,
  createGraphManageIntegrationAuth,
  parseJson,
  withIntegrationServer,
} from "./test-support/integration-server.ts";
import { requireGraphPayload } from "./test-support/payloads.ts";

await test("[integration] graph routes integration with postgres", async (t) => {
  const integrationDatabaseUrl = process.env["INTEGRATION_TEST_DATABASE_URL"]?.trim();
  if (!integrationDatabaseUrl) {
    t.skip("INTEGRATION_TEST_DATABASE_URL is not configured");
    return;
  }

  const { graphManageToken, createToken, jwtVerification } = createGraphManageIntegrationAuth();

  await t.test("supports full graph CRUD flow", async () => {
    await withIntegrationServer(integrationDatabaseUrl, jwtVerification, async (server) => {
      const emptyListResponse = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "GET",
        url: "/v1/graphs",
      });
      assert.equal(emptyListResponse.statusCode, 200);
      assert.deepEqual(parseJson(emptyListResponse), []);

      const createGraphResponse = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "POST",
        payload: {
          slug: "catalog",
        },
        url: "/v1/graphs",
      });
      assert.equal(createGraphResponse.statusCode, 201);
      assert.equal(createGraphResponse.headers.location, "/v1/graphs/catalog");

      const createdGraph = requireGraphPayload(parseJson(createGraphResponse));
      assert.equal(createdGraph.slug, "catalog");
      assert.equal(createdGraph.currentRevision, "1");
      assert.equal(createGraphResponse.headers.etag, formatStrongETag(createdGraph.id, 1));

      const duplicateCreateResponse = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "POST",
        payload: {
          slug: "catalog",
        },
        url: "/v1/graphs",
      });
      assert.equal(duplicateCreateResponse.statusCode, 409);

      const getGraphResponse = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "GET",
        url: "/v1/graphs/catalog",
      });
      assert.equal(getGraphResponse.statusCode, 200);
      assert.equal(getGraphResponse.headers.etag, formatStrongETag(createdGraph.id, 1));
      assert.deepEqual(parseJson(getGraphResponse), createdGraph);

      const updateGraphResponse = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "PUT",
        payload: {},
        url: "/v1/graphs/catalog",
      });
      assert.equal(updateGraphResponse.statusCode, 200);

      const updatedGraph = requireGraphPayload(parseJson(updateGraphResponse));
      assert.equal(updatedGraph.id, createdGraph.id);
      assert.equal(updatedGraph.slug, createdGraph.slug);
      assert.equal(updatedGraph.currentRevision, "1");
      assert.equal(updateGraphResponse.headers.etag, formatStrongETag(updatedGraph.id, 1));

      const noOpUpdateResponse = await server.inject({
        headers: authorizationIfMatchHeaders(
          graphManageToken,
          formatStrongETag(updatedGraph.id, 1),
        ),
        method: "PUT",
        payload: {},
        url: "/v1/graphs/catalog",
      });
      assert.equal(noOpUpdateResponse.statusCode, 200);
      assert.equal(noOpUpdateResponse.headers.etag, formatStrongETag(updatedGraph.id, 1));
      assert.deepEqual(parseJson(noOpUpdateResponse), updatedGraph);

      const staleUpdateResponse = await server.inject({
        headers: authorizationIfMatchHeaders(
          graphManageToken,
          formatStrongETag(createdGraph.id, 2),
        ),
        method: "PUT",
        payload: {},
        url: "/v1/graphs/catalog",
      });
      assert.equal(staleUpdateResponse.statusCode, 412);

      const createSubgraphResponse = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "POST",
        payload: {
          routingUrl: "https://inventory.example.com/graphql",
          slug: "inventory",
        },
        url: "/v1/graphs/catalog/subgraphs",
      });
      assert.equal(createSubgraphResponse.statusCode, 201);

      const staleDeleteResponse = await server.inject({
        headers: authorizationIfMatchHeaders(
          graphManageToken,
          formatStrongETag(createdGraph.id, 2),
        ),
        method: "DELETE",
        url: "/v1/graphs/catalog",
      });
      assert.equal(staleDeleteResponse.statusCode, 412);

      const deleteGraphResponse = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "DELETE",
        url: "/v1/graphs/catalog",
      });
      assert.equal(deleteGraphResponse.statusCode, 204);

      const deletedGetResponse = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "GET",
        url: "/v1/graphs/catalog",
      });
      assert.equal(deletedGetResponse.statusCode, 404);

      const deletedListResponse = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "GET",
        url: "/v1/graphs",
      });
      assert.equal(deletedListResponse.statusCode, 200);
      assert.deepEqual(parseJson(deletedListResponse), []);

      const subgraphGetAfterGraphDelete = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "GET",
        url: "/v1/graphs/catalog/subgraphs/inventory",
      });
      assert.equal(subgraphGetAfterGraphDelete.statusCode, 404);

      const subgraphListAfterGraphDelete = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "GET",
        url: "/v1/graphs/catalog/subgraphs",
      });
      assert.equal(subgraphListAfterGraphDelete.statusCode, 404);

      const missingDeleteResponse = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "DELETE",
        url: "/v1/graphs/catalog",
      });
      assert.equal(missingDeleteResponse.statusCode, 204);

      const recreateGraphResponse = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "POST",
        payload: {
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
        headers: authorizationIfMatchHeaders(
          graphManageToken,
          formatStrongETag(createdGraph.id, 1),
        ),
        method: "PUT",
        payload: {},
        url: "/v1/graphs/catalog",
      });
      assert.equal(staleRecreatedUpdateResponse.statusCode, 412);

      const staleRecreatedDeleteResponse = await server.inject({
        headers: authorizationIfMatchHeaders(
          graphManageToken,
          formatStrongETag(createdGraph.id, 1),
        ),
        method: "DELETE",
        url: "/v1/graphs/catalog",
      });
      assert.equal(staleRecreatedDeleteResponse.statusCode, 412);

      const staleRecreatedSubgraphCreateResponse = await server.inject({
        headers: authorizationIfMatchHeaders(
          graphManageToken,
          formatStrongETag(createdGraph.id, 1),
        ),
        method: "POST",
        payload: {
          routingUrl: "https://inventory-recreated.example.com/graphql",
          slug: "inventory",
        },
        url: "/v1/graphs/catalog/subgraphs",
      });
      assert.equal(staleRecreatedSubgraphCreateResponse.statusCode, 412);

      const recreatedSubgraphCreateResponse = await server.inject({
        headers: authorizationIfMatchHeaders(
          graphManageToken,
          formatStrongETag(recreatedGraph.id, 1),
        ),
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
        headers: authorizationHeaders(graphManageToken),
        method: "GET",
        url: "/v1/graphs/missing",
      });
      assert.equal(getResponse.statusCode, 404);

      const unconditionalUpdateResponse = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "PUT",
        payload: {},
        url: "/v1/graphs/missing",
      });
      assert.equal(unconditionalUpdateResponse.statusCode, 404);

      const updateResponse = await server.inject({
        headers: authorizationIfMatchHeaders(graphManageToken, formatStrongETag("graph-1", 1)),
        method: "PUT",
        payload: {},
        url: "/v1/graphs/missing",
      });
      assert.equal(updateResponse.statusCode, 412);

      const deleteResponse = await server.inject({
        headers: authorizationIfMatchHeaders(graphManageToken, formatStrongETag("graph-1", 1)),
        method: "DELETE",
        url: "/v1/graphs/missing",
      });
      assert.equal(deleteResponse.statusCode, 412);

      const idempotentDeleteResponse = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "DELETE",
        url: "/v1/graphs/missing",
      });
      assert.equal(idempotentDeleteResponse.statusCode, 204);
    });
  });

  await t.test(
    "returns 403 for unauthorized graph:manage users before evaluating If-Match on existing graphs",
    async () => {
      await withIntegrationServer(integrationDatabaseUrl, jwtVerification, async (server) => {
        const createGraphResponse = await server.inject({
          headers: authorizationHeaders(graphManageToken),
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

        const unauthorizedUpdateResponse = await server.inject({
          headers: authorizationIfMatchHeaders(
            unauthorizedManageToken,
            formatStrongETag(createdGraph.id, 2),
          ),
          method: "PUT",
          payload: {},
          url: "/v1/graphs/catalog",
        });
        assert.equal(unauthorizedUpdateResponse.statusCode, 403);

        const unauthorizedDeleteResponse = await server.inject({
          headers: authorizationIfMatchHeaders(
            unauthorizedManageToken,
            formatStrongETag(createdGraph.id, 2),
          ),
          method: "DELETE",
          url: "/v1/graphs/catalog",
        });
        assert.equal(unauthorizedDeleteResponse.statusCode, 403);
      });
    },
  );

  await t.test(
    "returns 403 for scoped graph:manage reads when graphs are hidden or missing",
    async () => {
      await withIntegrationServer(integrationDatabaseUrl, jwtVerification, async (server) => {
        const createCatalogResponse = await server.inject({
          headers: authorizationHeaders(graphManageToken),
          method: "POST",
          payload: {
            slug: "catalog",
          },
          url: "/v1/graphs",
        });
        assert.equal(createCatalogResponse.statusCode, 201);

        const scopedManageToken = createToken({
          authorization_details: [
            {
              graph_id: "managed-graph-id",
              scope: "graph:manage",
              type: authorizationDetailsType,
            },
          ],
        });

        const hiddenGraphGetResponse = await server.inject({
          headers: authorizationHeaders(scopedManageToken),
          method: "GET",
          url: "/v1/graphs/catalog",
        });
        assert.equal(hiddenGraphGetResponse.statusCode, 403);

        const missingGraphGetResponse = await server.inject({
          headers: authorizationHeaders(scopedManageToken),
          method: "GET",
          url: "/v1/graphs/missing",
        });
        assert.equal(missingGraphGetResponse.statusCode, 403);
      });
    },
  );

  await t.test("returns 403 for scoped graph:manage writes when graphs are missing", async () => {
    await withIntegrationServer(integrationDatabaseUrl, jwtVerification, async (server) => {
      const createCatalogResponse = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "POST",
        payload: {
          slug: "catalog",
        },
        url: "/v1/graphs",
      });
      assert.equal(createCatalogResponse.statusCode, 201);

      const scopedManageToken = createToken({
        authorization_details: [
          {
            graph_id: "managed-graph-id",
            scope: "graph:manage",
            type: authorizationDetailsType,
          },
        ],
      });

      const missingGraphPutResponse = await server.inject({
        headers: authorizationIfMatchHeaders(scopedManageToken, "*"),
        method: "PUT",
        payload: {},
        url: "/v1/graphs/missing",
      });
      assert.equal(missingGraphPutResponse.statusCode, 403);

      const missingGraphDeleteResponse = await server.inject({
        headers: authorizationIfMatchHeaders(scopedManageToken, "*"),
        method: "DELETE",
        url: "/v1/graphs/missing",
      });
      assert.equal(missingGraphDeleteResponse.statusCode, 403);
    });
  });

  await t.test("filters GET /v1/graphs by graph:manage visibility", async () => {
    await withIntegrationServer(integrationDatabaseUrl, jwtVerification, async (server) => {
      const createCatalogResponse = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "POST",
        payload: {
          slug: "catalog",
        },
        url: "/v1/graphs",
      });
      assert.equal(createCatalogResponse.statusCode, 201);
      const catalogGraph = requireGraphPayload(parseJson(createCatalogResponse));

      const createReviewsResponse = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "POST",
        payload: {
          slug: "reviews",
        },
        url: "/v1/graphs",
      });
      assert.equal(createReviewsResponse.statusCode, 201);
      requireGraphPayload(parseJson(createReviewsResponse));

      const scopedManageToken = createToken({
        authorization_details: [
          {
            graph_id: catalogGraph.id,
            scope: "graph:manage",
            type: authorizationDetailsType,
          },
        ],
      });

      const response = await server.inject({
        headers: authorizationHeaders(scopedManageToken),
        method: "GET",
        url: "/v1/graphs",
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(parseJson(response), [catalogGraph]);
    });
  });

  await t.test(
    "returns 200 with an empty graph list when no graph:manage grants match",
    async () => {
      await withIntegrationServer(integrationDatabaseUrl, jwtVerification, async (server) => {
        const createCatalogResponse = await server.inject({
          headers: authorizationHeaders(graphManageToken),
          method: "POST",
          payload: {
            slug: "catalog",
          },
          url: "/v1/graphs",
        });
        assert.equal(createCatalogResponse.statusCode, 201);

        const schemaReadOnlyToken = createToken({
          authorization_details: [
            {
              graph_id: "*",
              scope: "supergraph_schema:read",
              type: authorizationDetailsType,
            },
          ],
        });

        const response = await server.inject({
          headers: authorizationHeaders(schemaReadOnlyToken),
          method: "GET",
          url: "/v1/graphs",
        });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(parseJson(response), []);
      });
    },
  );

  await t.test("requires wildcard graph:manage to create graphs", async () => {
    await withIntegrationServer(integrationDatabaseUrl, jwtVerification, async (server) => {
      const createCatalogResponse = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "POST",
        payload: {
          slug: "catalog",
        },
        url: "/v1/graphs",
      });
      assert.equal(createCatalogResponse.statusCode, 201);
      const catalogGraph = requireGraphPayload(parseJson(createCatalogResponse));

      const createReviewsResponse = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "POST",
        payload: {
          slug: "reviews",
        },
        url: "/v1/graphs",
      });
      assert.equal(createReviewsResponse.statusCode, 201);
      requireGraphPayload(parseJson(createReviewsResponse));

      const scopedManageToken = createToken({
        authorization_details: [
          {
            graph_id: catalogGraph.id,
            scope: "graph:manage",
            type: authorizationDetailsType,
          },
        ],
      });

      const scopedListResponse = await server.inject({
        headers: authorizationHeaders(scopedManageToken),
        method: "GET",
        url: "/v1/graphs",
      });
      assert.equal(scopedListResponse.statusCode, 200);
      assert.deepEqual(parseJson(scopedListResponse), [catalogGraph]);

      const scopedCreateResponse = await server.inject({
        headers: authorizationHeaders(scopedManageToken),
        method: "POST",
        payload: {
          slug: "products",
        },
        url: "/v1/graphs",
      });
      assert.equal(scopedCreateResponse.statusCode, 403);
    });
  });

  await t.test("returns 400 for invalid if-match headers", async () => {
    await withIntegrationServer(integrationDatabaseUrl, jwtVerification, async (server) => {
      const createGraphResponse = await server.inject({
        headers: authorizationHeaders(graphManageToken),
        method: "POST",
        payload: {
          slug: "catalog",
        },
        url: "/v1/graphs",
      });
      assert.equal(createGraphResponse.statusCode, 201);

      const invalidUpdateResponse = await server.inject({
        headers: authorizationIfMatchHeaders(graphManageToken, "invalid-etag"),
        method: "PUT",
        payload: {},
        url: "/v1/graphs/catalog",
      });
      assert.equal(invalidUpdateResponse.statusCode, 400);

      const invalidDeleteResponse = await server.inject({
        headers: authorizationIfMatchHeaders(graphManageToken, "invalid-etag"),
        method: "DELETE",
        url: "/v1/graphs/catalog",
      });
      assert.equal(invalidDeleteResponse.statusCode, 400);
    });
  });
});
