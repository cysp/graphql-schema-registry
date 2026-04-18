import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { formatStrongETag } from "./domain/etag.ts";
import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import { normalizeSchemaSdl } from "./domain/subgraph-schema.ts";
import {
  authorizationHeaders,
  authorizationIfMatchHeaders,
  parseJson,
  requireIntegrationDatabaseUrl,
  withIntegrationServer,
} from "./test-support/integration-server.ts";
import { requireGraphPayload, requireSubgraphPayload } from "./test-support/payloads.ts";

const firstSchemaSdl = `
  type Query { products: [String!]! }
`;

const equivalentSchemaSdl = `
type Query{
products:[String!]!
}
`;

const secondSchemaSdl = `
  type Query {
    products: [String!]!
    product(id: ID!): String
  }
`;

const invalidSchemaSdl = `
  type Query {
`;

function createSubgraphSchemaGrantToken(
  createToken: ReturnType<typeof createAuthJwtSigner>["createToken"],
  scope: "subgraph_schema:read" | "subgraph_schema:write",
  graphId: string,
  subgraphId: string,
): string {
  return createToken({
    authorization_details: [
      {
        graph_id: graphId,
        scope,
        subgraph_id: subgraphId,
        type: authorizationDetailsType,
      },
    ],
  });
}

function createWildcardSubgraphSchemaGrantToken(
  createToken: ReturnType<typeof createAuthJwtSigner>["createToken"],
  scope: "subgraph_schema:read" | "subgraph_schema:write",
): string {
  return createToken({
    authorization_details: [
      {
        graph_id: "*",
        scope,
        subgraph_id: "*",
        type: authorizationDetailsType,
      },
    ],
  });
}

await test("[integration] subgraph schema routes integration with postgres", async (t) => {
  const integrationDatabaseUrl = requireIntegrationDatabaseUrl(t);
  if (!integrationDatabaseUrl) {
    return;
  }

  const jwtSigner = createAuthJwtSigner();
  const graphManageToken = jwtSigner.createToken({
    authorization_details: [
      {
        graph_id: "*",
        scope: "graph:manage",
        type: authorizationDetailsType,
      },
    ],
  });

  await t.test("supports publishing and reading a normalized subgraph schema", async () => {
    await withIntegrationServer(
      integrationDatabaseUrl,
      jwtSigner.jwtVerification,
      async (server) => {
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

        const createSubgraphResponse = await server.inject({
          headers: authorizationHeaders(graphManageToken),
          method: "POST",
          payload: {
            routingUrl: "https://inventory-v1.example.com/graphql",
            slug: "inventory",
          },
          url: "/v1/graphs/catalog/subgraphs",
        });
        assert.equal(createSubgraphResponse.statusCode, 201);
        const createdSubgraph = requireSubgraphPayload(parseJson(createSubgraphResponse));

        const schemaReadToken = createSubgraphSchemaGrantToken(
          jwtSigner.createToken,
          "subgraph_schema:read",
          createdGraph.id,
          createdSubgraph.id,
        );
        const schemaWriteToken = createSubgraphSchemaGrantToken(
          jwtSigner.createToken,
          "subgraph_schema:write",
          createdGraph.id,
          createdSubgraph.id,
        );

        const missingGetResponse = await server.inject({
          headers: authorizationHeaders(schemaReadToken),
          method: "GET",
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(missingGetResponse.statusCode, 404);

        const firstPublishResponse = await server.inject({
          headers: {
            ...authorizationHeaders(schemaWriteToken),
            "content-type": "text/plain",
          },
          method: "POST",
          payload: firstSchemaSdl,
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(firstPublishResponse.statusCode, 204);
        assert.equal(firstPublishResponse.body, "");
        const firstSchemaEtag = String(firstPublishResponse.headers.etag);
        assert.equal(firstSchemaEtag, formatStrongETag(createdSubgraph.id, 1));

        const getPublishedSchemaResponse = await server.inject({
          headers: authorizationHeaders(schemaReadToken),
          method: "GET",
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(getPublishedSchemaResponse.statusCode, 200);
        assert.match(String(getPublishedSchemaResponse.headers["content-type"]), /^text\/plain\b/);
        assert.equal(getPublishedSchemaResponse.headers.etag, firstSchemaEtag);
        assert.equal(getPublishedSchemaResponse.body, normalizeSchemaSdl(firstSchemaSdl));

        const metadataGetResponse = await server.inject({
          headers: authorizationHeaders(graphManageToken),
          method: "GET",
          url: "/v1/graphs/catalog/subgraphs/inventory",
        });
        assert.equal(metadataGetResponse.statusCode, 200);
        assert.equal(metadataGetResponse.headers.etag, formatStrongETag(createdSubgraph.id, 1));
        const metadataSubgraph = requireSubgraphPayload(parseJson(metadataGetResponse));
        assert.equal(metadataSubgraph.updatedAt, createdSubgraph.updatedAt);

        const noOpPublishResponse = await server.inject({
          headers: {
            ...authorizationIfMatchHeaders(schemaWriteToken, firstSchemaEtag),
            "content-type": "text/plain",
          },
          method: "POST",
          payload: equivalentSchemaSdl,
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(noOpPublishResponse.statusCode, 204);
        assert.equal(noOpPublishResponse.headers.etag, firstSchemaEtag);

        const changedPublishResponse = await server.inject({
          headers: {
            ...authorizationIfMatchHeaders(schemaWriteToken, firstSchemaEtag),
            "content-type": "text/plain",
          },
          method: "POST",
          payload: secondSchemaSdl,
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(changedPublishResponse.statusCode, 204);
        const secondSchemaEtag = String(changedPublishResponse.headers.etag);
        assert.equal(secondSchemaEtag, formatStrongETag(createdSubgraph.id, 2));

        const getUpdatedSchemaResponse = await server.inject({
          headers: authorizationHeaders(schemaReadToken),
          method: "GET",
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(getUpdatedSchemaResponse.statusCode, 200);
        assert.equal(getUpdatedSchemaResponse.headers.etag, secondSchemaEtag);
        assert.equal(getUpdatedSchemaResponse.body, normalizeSchemaSdl(secondSchemaSdl));

        const deleteSchemaResponse = await server.inject({
          headers: authorizationIfMatchHeaders(schemaWriteToken, secondSchemaEtag),
          method: "DELETE",
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(deleteSchemaResponse.statusCode, 204);
        assert.equal(deleteSchemaResponse.body, "");

        const getDeletedSchemaResponse = await server.inject({
          headers: authorizationHeaders(schemaReadToken),
          method: "GET",
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(getDeletedSchemaResponse.statusCode, 404);

        const republishResponse = await server.inject({
          headers: {
            ...authorizationHeaders(schemaWriteToken),
            "content-type": "text/plain",
          },
          method: "POST",
          payload: firstSchemaSdl,
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(republishResponse.statusCode, 204);
        const thirdSchemaEtag = String(republishResponse.headers.etag);
        assert.equal(thirdSchemaEtag, formatStrongETag(createdSubgraph.id, 3));

        const metadataAfterSchemaPublishResponse = await server.inject({
          headers: authorizationHeaders(graphManageToken),
          method: "GET",
          url: "/v1/graphs/catalog/subgraphs/inventory",
        });
        assert.equal(metadataAfterSchemaPublishResponse.statusCode, 200);
        assert.equal(
          metadataAfterSchemaPublishResponse.headers.etag,
          formatStrongETag(createdSubgraph.id, 1),
        );
        const metadataAfterSchemaPublish = requireSubgraphPayload(
          parseJson(metadataAfterSchemaPublishResponse),
        );
        assert.equal(metadataAfterSchemaPublish.updatedAt, createdSubgraph.updatedAt);

        const updateSubgraphResponse = await server.inject({
          headers: authorizationHeaders(graphManageToken),
          method: "PUT",
          payload: {
            routingUrl: "https://inventory-v2.example.com/graphql",
          },
          url: "/v1/graphs/catalog/subgraphs/inventory",
        });
        assert.equal(updateSubgraphResponse.statusCode, 200);
        const updatedSubgraph = requireSubgraphPayload(parseJson(updateSubgraphResponse));
        assert.equal(updatedSubgraph.currentRevision, "2");

        const schemaAfterMetadataUpdateResponse = await server.inject({
          headers: authorizationHeaders(schemaReadToken),
          method: "GET",
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(schemaAfterMetadataUpdateResponse.statusCode, 200);
        assert.equal(schemaAfterMetadataUpdateResponse.headers.etag, thirdSchemaEtag);
        assert.equal(schemaAfterMetadataUpdateResponse.body, normalizeSchemaSdl(firstSchemaSdl));
      },
    );
  });

  await t.test("returns 403 for graph:manage users on subgraph schema endpoints", async () => {
    await withIntegrationServer(
      integrationDatabaseUrl,
      jwtSigner.jwtVerification,
      async (server) => {
        const createGraphResponse = await server.inject({
          headers: authorizationHeaders(graphManageToken),
          method: "POST",
          payload: {
            slug: "catalog",
          },
          url: "/v1/graphs",
        });
        assert.equal(createGraphResponse.statusCode, 201);
        requireGraphPayload(parseJson(createGraphResponse));

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
        requireSubgraphPayload(parseJson(createSubgraphResponse));

        const graphManagePublishResponse = await server.inject({
          headers: {
            ...authorizationHeaders(graphManageToken),
            "content-type": "text/plain",
          },
          method: "POST",
          payload: firstSchemaSdl,
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(graphManagePublishResponse.statusCode, 403);

        const graphManageGetResponse = await server.inject({
          headers: authorizationHeaders(graphManageToken),
          method: "GET",
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(graphManageGetResponse.statusCode, 403);

        const graphManageDeleteResponse = await server.inject({
          headers: authorizationHeaders(graphManageToken),
          method: "DELETE",
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(graphManageDeleteResponse.statusCode, 403);
      },
    );
  });

  await t.test("returns 403 when schema grants do not match the endpoint verb", async () => {
    await withIntegrationServer(
      integrationDatabaseUrl,
      jwtSigner.jwtVerification,
      async (server) => {
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
        const createdSubgraph = requireSubgraphPayload(parseJson(createSubgraphResponse));

        const schemaReadToken = createSubgraphSchemaGrantToken(
          jwtSigner.createToken,
          "subgraph_schema:read",
          createdGraph.id,
          createdSubgraph.id,
        );
        const schemaWriteToken = createSubgraphSchemaGrantToken(
          jwtSigner.createToken,
          "subgraph_schema:write",
          createdGraph.id,
          createdSubgraph.id,
        );

        const writeOnlyGetResponse = await server.inject({
          headers: authorizationHeaders(schemaWriteToken),
          method: "GET",
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(writeOnlyGetResponse.statusCode, 403);

        const readOnlyPublishResponse = await server.inject({
          headers: {
            ...authorizationHeaders(schemaReadToken),
            "content-type": "text/plain",
          },
          method: "POST",
          payload: firstSchemaSdl,
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(readOnlyPublishResponse.statusCode, 403);
      },
    );
  });

  await t.test("returns 400 for invalid If-Match headers on schema writes", async () => {
    await withIntegrationServer(
      integrationDatabaseUrl,
      jwtSigner.jwtVerification,
      async (server) => {
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
        const createdSubgraph = requireSubgraphPayload(parseJson(createSubgraphResponse));

        const schemaWriteToken = createSubgraphSchemaGrantToken(
          jwtSigner.createToken,
          "subgraph_schema:write",
          createdGraph.id,
          createdSubgraph.id,
        );

        const invalidIfMatchResponse = await server.inject({
          headers: {
            ...authorizationIfMatchHeaders(schemaWriteToken, "invalid-etag"),
            "content-type": "text/plain",
          },
          method: "POST",
          payload: firstSchemaSdl,
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(invalidIfMatchResponse.statusCode, 400);
      },
    );
  });

  await t.test("returns 422 for invalid schema payloads", async () => {
    await withIntegrationServer(
      integrationDatabaseUrl,
      jwtSigner.jwtVerification,
      async (server) => {
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
        const createdSubgraph = requireSubgraphPayload(parseJson(createSubgraphResponse));

        const schemaWriteToken = createSubgraphSchemaGrantToken(
          jwtSigner.createToken,
          "subgraph_schema:write",
          createdGraph.id,
          createdSubgraph.id,
        );

        const invalidSchemaResponse = await server.inject({
          headers: {
            ...authorizationHeaders(schemaWriteToken),
            "content-type": "text/plain",
          },
          method: "POST",
          payload: invalidSchemaSdl,
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(invalidSchemaResponse.statusCode, 422);
      },
    );
  });

  await t.test("returns 412 for stale schema write preconditions", async () => {
    await withIntegrationServer(
      integrationDatabaseUrl,
      jwtSigner.jwtVerification,
      async (server) => {
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
        const createdSubgraph = requireSubgraphPayload(parseJson(createSubgraphResponse));

        const schemaWriteToken = createSubgraphSchemaGrantToken(
          jwtSigner.createToken,
          "subgraph_schema:write",
          createdGraph.id,
          createdSubgraph.id,
        );

        const publishResponse = await server.inject({
          headers: {
            ...authorizationHeaders(schemaWriteToken),
            "content-type": "text/plain",
          },
          method: "POST",
          payload: firstSchemaSdl,
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(publishResponse.statusCode, 204);
        const staleDeleteResponse = await server.inject({
          headers: authorizationIfMatchHeaders(
            schemaWriteToken,
            formatStrongETag(createdSubgraph.id, 999),
          ),
          method: "DELETE",
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(staleDeleteResponse.statusCode, 412);

        const stalePublishResponse = await server.inject({
          headers: {
            ...authorizationIfMatchHeaders(
              schemaWriteToken,
              formatStrongETag(createdSubgraph.id, 999),
            ),
            "content-type": "text/plain",
          },
          method: "POST",
          payload: secondSchemaSdl,
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(stalePublishResponse.statusCode, 412);
      },
    );
  });

  await t.test(
    "returns 403 for scoped schema grants when the target graph is missing",
    async () => {
      await withIntegrationServer(
        integrationDatabaseUrl,
        jwtSigner.jwtVerification,
        async (server) => {
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
          const createdSubgraph = requireSubgraphPayload(parseJson(createSubgraphResponse));

          const schemaReadToken = createSubgraphSchemaGrantToken(
            jwtSigner.createToken,
            "subgraph_schema:read",
            createdGraph.id,
            createdSubgraph.id,
          );
          const schemaWriteToken = createSubgraphSchemaGrantToken(
            jwtSigner.createToken,
            "subgraph_schema:write",
            createdGraph.id,
            createdSubgraph.id,
          );

          const publishResponse = await server.inject({
            headers: {
              ...authorizationHeaders(schemaWriteToken),
              "content-type": "text/plain",
            },
            method: "POST",
            payload: firstSchemaSdl,
            url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
          });
          assert.equal(publishResponse.statusCode, 204);
          const currentEtag = String(publishResponse.headers.etag);

          const missingGraphGetResponse = await server.inject({
            headers: authorizationHeaders(schemaReadToken),
            method: "GET",
            url: "/v1/graphs/missing/subgraphs/inventory/schema.graphqls",
          });
          assert.equal(missingGraphGetResponse.statusCode, 403);

          const missingGraphPublishResponse = await server.inject({
            headers: {
              ...authorizationHeaders(schemaWriteToken),
              "content-type": "text/plain",
            },
            method: "POST",
            payload: firstSchemaSdl,
            url: "/v1/graphs/missing/subgraphs/inventory/schema.graphqls",
          });
          assert.equal(missingGraphPublishResponse.statusCode, 403);

          const missingGraphDeleteResponse = await server.inject({
            headers: authorizationHeaders(schemaWriteToken),
            method: "DELETE",
            url: "/v1/graphs/missing/subgraphs/inventory/schema.graphqls",
          });
          assert.equal(missingGraphDeleteResponse.statusCode, 403);

          const staleMissingGraphPublishResponse = await server.inject({
            headers: {
              ...authorizationIfMatchHeaders(schemaWriteToken, currentEtag),
              "content-type": "text/plain",
            },
            method: "POST",
            payload: secondSchemaSdl,
            url: "/v1/graphs/missing/subgraphs/inventory/schema.graphqls",
          });
          assert.equal(staleMissingGraphPublishResponse.statusCode, 403);

          const staleMissingGraphDeleteResponse = await server.inject({
            headers: authorizationIfMatchHeaders(schemaWriteToken, currentEtag),
            method: "DELETE",
            url: "/v1/graphs/missing/subgraphs/inventory/schema.graphqls",
          });
          assert.equal(staleMissingGraphDeleteResponse.statusCode, 403);
        },
      );
    },
  );

  await t.test(
    "returns 403 for scoped schema grants when graph or subgraph targets are hidden",
    async () => {
      await withIntegrationServer(
        integrationDatabaseUrl,
        jwtSigner.jwtVerification,
        async (server) => {
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

          const createInventoryResponse = await server.inject({
            headers: authorizationHeaders(graphManageToken),
            method: "POST",
            payload: {
              routingUrl: "https://inventory.example.com/graphql",
              slug: "inventory",
            },
            url: "/v1/graphs/catalog/subgraphs",
          });
          assert.equal(createInventoryResponse.statusCode, 201);
          const inventorySubgraph = requireSubgraphPayload(parseJson(createInventoryResponse));

          const createReviewsGraphResponse = await server.inject({
            headers: authorizationHeaders(graphManageToken),
            method: "POST",
            payload: {
              slug: "reviews",
            },
            url: "/v1/graphs",
          });
          assert.equal(createReviewsGraphResponse.statusCode, 201);

          const createWarehouseResponse = await server.inject({
            headers: authorizationHeaders(graphManageToken),
            method: "POST",
            payload: {
              routingUrl: "https://warehouse.example.com/graphql",
              slug: "warehouse",
            },
            url: "/v1/graphs/reviews/subgraphs",
          });
          assert.equal(createWarehouseResponse.statusCode, 201);

          const scopedSchemaReadToken = createSubgraphSchemaGrantToken(
            jwtSigner.createToken,
            "subgraph_schema:read",
            catalogGraph.id,
            inventorySubgraph.id,
          );
          const scopedSchemaWriteToken = createSubgraphSchemaGrantToken(
            jwtSigner.createToken,
            "subgraph_schema:write",
            catalogGraph.id,
            inventorySubgraph.id,
          );

          const hiddenSchemaGetResponse = await server.inject({
            headers: authorizationHeaders(scopedSchemaReadToken),
            method: "GET",
            url: "/v1/graphs/reviews/subgraphs/warehouse/schema.graphqls",
          });
          assert.equal(hiddenSchemaGetResponse.statusCode, 403);

          const hiddenSchemaPublishResponse = await server.inject({
            headers: {
              ...authorizationHeaders(scopedSchemaWriteToken),
              "content-type": "text/plain",
            },
            method: "POST",
            payload: firstSchemaSdl,
            url: "/v1/graphs/reviews/subgraphs/warehouse/schema.graphqls",
          });
          assert.equal(hiddenSchemaPublishResponse.statusCode, 403);

          const hiddenSchemaDeleteResponse = await server.inject({
            headers: authorizationHeaders(scopedSchemaWriteToken),
            method: "DELETE",
            url: "/v1/graphs/reviews/subgraphs/warehouse/schema.graphqls",
          });
          assert.equal(hiddenSchemaDeleteResponse.statusCode, 403);
        },
      );
    },
  );

  await t.test("returns normal missing-resource semantics for wildcard schema grants", async () => {
    await withIntegrationServer(
      integrationDatabaseUrl,
      jwtSigner.jwtVerification,
      async (server) => {
        const wildcardSchemaReadToken = createWildcardSubgraphSchemaGrantToken(
          jwtSigner.createToken,
          "subgraph_schema:read",
        );
        const wildcardSchemaWriteToken = createWildcardSubgraphSchemaGrantToken(
          jwtSigner.createToken,
          "subgraph_schema:write",
        );

        const missingGraphGetResponse = await server.inject({
          headers: authorizationHeaders(wildcardSchemaReadToken),
          method: "GET",
          url: "/v1/graphs/missing/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(missingGraphGetResponse.statusCode, 404);

        const missingGraphPublishResponse = await server.inject({
          headers: {
            ...authorizationHeaders(wildcardSchemaWriteToken),
            "content-type": "text/plain",
          },
          method: "POST",
          payload: firstSchemaSdl,
          url: "/v1/graphs/missing/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(missingGraphPublishResponse.statusCode, 404);

        const missingGraphDeleteResponse = await server.inject({
          headers: authorizationHeaders(wildcardSchemaWriteToken),
          method: "DELETE",
          url: "/v1/graphs/missing/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(missingGraphDeleteResponse.statusCode, 204);
      },
    );
  });
});
