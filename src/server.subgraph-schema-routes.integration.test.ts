// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { formatStrongETag } from "./domain/etag.ts";
import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import { normalizeSchemaSdl } from "./domain/subgraph-schema.ts";
import {
  adminHeaders,
  authorizationHeaders,
  authorizationIfMatchHeaders,
  parseJson,
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
  scope: "subgraph-schema:read" | "subgraph-schema:write",
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

await test("subgraph schema routes integration with postgres", async (t) => {
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

  await t.test("supports publishing and reading a normalized subgraph schema", async () => {
    await withIntegrationServer(
      integrationDatabaseUrl,
      jwtSigner.jwtVerification,
      async (server) => {
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
        const createdSubgraph = requireSubgraphPayload(parseJson(createSubgraphResponse));

        const schemaReadToken = createSubgraphSchemaGrantToken(
          jwtSigner.createToken,
          "subgraph-schema:read",
          createdGraph.id,
          createdSubgraph.id,
        );
        const schemaWriteToken = createSubgraphSchemaGrantToken(
          jwtSigner.createToken,
          "subgraph-schema:write",
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
          headers: adminHeaders(adminToken),
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

        const metadataAfterSchemaPublishResponse = await server.inject({
          headers: adminHeaders(adminToken),
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
          headers: adminHeaders(adminToken),
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
        assert.equal(schemaAfterMetadataUpdateResponse.headers.etag, secondSchemaEtag);
        assert.equal(schemaAfterMetadataUpdateResponse.body, normalizeSchemaSdl(secondSchemaSdl));
      },
    );
  });

  await t.test("returns expected errors and auth statuses", async () => {
    await withIntegrationServer(
      integrationDatabaseUrl,
      jwtSigner.jwtVerification,
      async (server) => {
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
        const createdSubgraph = requireSubgraphPayload(parseJson(createSubgraphResponse));

        const schemaReadToken = createSubgraphSchemaGrantToken(
          jwtSigner.createToken,
          "subgraph-schema:read",
          createdGraph.id,
          createdSubgraph.id,
        );
        const schemaWriteToken = createSubgraphSchemaGrantToken(
          jwtSigner.createToken,
          "subgraph-schema:write",
          createdGraph.id,
          createdSubgraph.id,
        );

        const adminPublishResponse = await server.inject({
          headers: {
            ...adminHeaders(adminToken),
            "content-type": "text/plain",
          },
          method: "POST",
          payload: firstSchemaSdl,
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(adminPublishResponse.statusCode, 403);

        const adminGetResponse = await server.inject({
          headers: adminHeaders(adminToken),
          method: "GET",
          url: "/v1/graphs/catalog/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(adminGetResponse.statusCode, 403);

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

        const missingGraphGetResponse = await server.inject({
          headers: authorizationHeaders(schemaReadToken),
          method: "GET",
          url: "/v1/graphs/missing/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(missingGraphGetResponse.statusCode, 404);

        const missingGraphPublishResponse = await server.inject({
          headers: {
            ...authorizationHeaders(schemaWriteToken),
            "content-type": "text/plain",
          },
          method: "POST",
          payload: firstSchemaSdl,
          url: "/v1/graphs/missing/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(missingGraphPublishResponse.statusCode, 404);

        const staleMissingGraphPublishResponse = await server.inject({
          headers: {
            ...authorizationIfMatchHeaders(schemaWriteToken, currentEtag),
            "content-type": "text/plain",
          },
          method: "POST",
          payload: secondSchemaSdl,
          url: "/v1/graphs/missing/subgraphs/inventory/schema.graphqls",
        });
        assert.equal(staleMissingGraphPublishResponse.statusCode, 412);
      },
    );
  });
});
