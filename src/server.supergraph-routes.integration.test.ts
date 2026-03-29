// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { selectGraphCompositionConstituentsCount } from "./domain/database/graph-compositions.ts";
import { selectActiveGraphBySlug } from "./domain/database/graphs/repository.ts";
import { formatStrongETag } from "./domain/etag.ts";
import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import { createFastifyServer } from "./server.ts";
import { connectIntegrationDatabase, queryCount } from "./test-support/database.ts";
import { parseJson } from "./test-support/integration-server.ts";
import { requireGraphPayload, requireSubgraphPayload } from "./test-support/payloads.ts";

function bearerHeaders(
  token: string,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    ...extraHeaders,
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  assert.ok(isObjectRecord(value));
  return value;
}

function requirePublishPayload(value: unknown): { revision: string } {
  const record = requireRecord(value);
  const revision = record["revision"];
  if (typeof revision !== "string") {
    throw new assert.AssertionError({
      actual: revision,
      expected: "string",
      message: "Expected revision to be a string.",
      operator: "===",
    });
  }
  return {
    revision,
  };
}

const productsSchema = [
  'extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])',
  "",
  'type Product @key(fields: "id") {',
  "  id: ID!",
  "  name: String!",
  "}",
  "",
  "type Query {",
  "  product(id: ID!): Product",
  "}",
].join("\n");

const incompatibleReviewsSchema = [
  'extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key", "@external"])',
  "",
  "type Review {",
  "  id: ID!",
  "  body: String!",
  "}",
  "",
  "type Query {",
  "  topReview: Review",
  "}",
  "",
  'extend type Product @key(fields: "sku") {',
  "  sku: ID! @external",
  "  reviews: [Review!]!",
  "}",
].join("\n");

const compatibleReviewsSchema = [
  'extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key", "@external"])',
  "",
  "type Review {",
  "  id: ID!",
  "  body: String!",
  "}",
  "",
  "type Query {",
  "  topReview: Review",
  "}",
  "",
  'extend type Product @key(fields: "id") {',
  "  id: ID! @external",
  "  reviews: [Review!]!",
  "}",
].join("\n");

const futureProductsSchema = [
  'extend schema @link(url: "https://specs.apollo.dev/federation/v2.13", import: ["@key"])',
  "",
  'type Product @key(fields: "id") {',
  "  id: ID!",
  "  name: String!",
  "}",
  "",
  "type Query {",
  "  product(id: ID!): Product",
  "}",
].join("\n");

await test("supergraph routes integration with postgres", async (t) => {
  const integrationDatabaseUrl = process.env["INTEGRATION_TEST_DATABASE_URL"]?.trim();
  if (!integrationDatabaseUrl) {
    t.skip("INTEGRATION_TEST_DATABASE_URL is not configured");
    return;
  }

  const jwtSigner = createAuthJwtSigner();
  const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);
  const server = createFastifyServer({
    database: integrationDatabase.database.database,
    jwtVerification: jwtSigner.jwtVerification,
  });

  const adminToken = jwtSigner.createToken({
    authorization_details: [
      {
        scope: "admin",
        type: authorizationDetailsType,
      },
    ],
  });

  try {
    await server.ready();

    const createGraphResponse = await server.inject({
      headers: bearerHeaders(adminToken, { "content-type": "application/json" }),
      method: "POST",
      payload: {
        federationVersion: "v2.9",
        slug: "catalog",
      },
      url: "/v1/graphs",
    });
    assert.equal(createGraphResponse.statusCode, 201);
    const graph = requireGraphPayload(parseJson(createGraphResponse));

    const createProductsResponse = await server.inject({
      headers: bearerHeaders(adminToken, { "content-type": "application/json" }),
      method: "POST",
      payload: {
        routingUrl: "https://products.example.com/graphql",
        slug: "products",
      },
      url: "/v1/graphs/catalog/subgraphs",
    });
    assert.equal(createProductsResponse.statusCode, 201);
    const productsSubgraph = requireSubgraphPayload(parseJson(createProductsResponse));

    const graphReadToken = jwtSigner.createToken({
      authorization_details: [
        {
          graph_id: graph.id,
          scope: "graph:read",
          type: authorizationDetailsType,
        },
      ],
    });
    const wrongGraphReadToken = jwtSigner.createToken({
      authorization_details: [
        {
          graph_id: "some-other-graph",
          scope: "graph:read",
          type: authorizationDetailsType,
        },
      ],
    });
    const wrongSubgraphWriteToken = jwtSigner.createToken({
      authorization_details: [
        {
          graph_id: graph.id,
          scope: "subgraph:write",
          subgraph_id: "some-other-subgraph",
          type: authorizationDetailsType,
        },
      ],
    });
    const productsWriteToken = jwtSigner.createToken({
      authorization_details: [
        {
          graph_id: graph.id,
          scope: "subgraph:write",
          subgraph_id: productsSubgraph.id,
          type: authorizationDetailsType,
        },
      ],
    });

    const initialGetResponse = await server.inject({
      headers: bearerHeaders(graphReadToken),
      method: "GET",
      url: "/v1/graphs/catalog/supergraph.graphqls",
    });
    assert.equal(initialGetResponse.statusCode, 404);

    const adminGetResponse = await server.inject({
      headers: bearerHeaders(adminToken),
      method: "GET",
      url: "/v1/graphs/catalog/supergraph.graphqls",
    });
    assert.equal(adminGetResponse.statusCode, 401);

    const wrongScopedGetResponse = await server.inject({
      headers: bearerHeaders(wrongGraphReadToken),
      method: "GET",
      url: "/v1/graphs/catalog/supergraph.graphqls",
    });
    assert.equal(wrongScopedGetResponse.statusCode, 401);

    const adminPublishResponse = await server.inject({
      headers: bearerHeaders(adminToken, { "content-type": "text/plain" }),
      method: "POST",
      payload: productsSchema,
      url: "/v1/graphs/catalog/subgraphs/products/schema.graphqls",
    });
    assert.equal(adminPublishResponse.statusCode, 401);

    const wrongScopedPublishResponse = await server.inject({
      headers: bearerHeaders(wrongSubgraphWriteToken, { "content-type": "text/plain" }),
      method: "POST",
      payload: productsSchema,
      url: "/v1/graphs/catalog/subgraphs/products/schema.graphqls",
    });
    assert.equal(wrongScopedPublishResponse.statusCode, 401);

    const firstPublishResponse = await server.inject({
      headers: bearerHeaders(productsWriteToken, { "content-type": "text/plain" }),
      method: "POST",
      payload: productsSchema,
      url: "/v1/graphs/catalog/subgraphs/products/schema.graphqls",
    });
    assert.equal(firstPublishResponse.statusCode, 201);
    assert.equal(requirePublishPayload(parseJson(firstPublishResponse)).revision, "1");

    const currentCompositionCount = await selectGraphCompositionConstituentsCount(
      integrationDatabase.database.database,
      graph.id,
      1,
    );
    assert.equal(currentCompositionCount, 1);

    const firstSupergraphResponse = await server.inject({
      headers: bearerHeaders(graphReadToken),
      method: "GET",
      url: "/v1/graphs/catalog/supergraph.graphqls",
    });
    assert.equal(firstSupergraphResponse.statusCode, 200);
    assert.match(firstSupergraphResponse.body, /type Product/);
    const firstSupergraphEtag = String(firstSupergraphResponse.headers.etag);
    assert.equal(firstSupergraphEtag, formatStrongETag(graph.id, 1));

    const notModifiedResponse = await server.inject({
      headers: bearerHeaders(graphReadToken, { "if-none-match": firstSupergraphEtag }),
      method: "GET",
      url: "/v1/graphs/catalog/supergraph.graphqls",
    });
    assert.equal(notModifiedResponse.statusCode, 304);
    assert.equal(notModifiedResponse.headers.etag, firstSupergraphEtag);
    assert.equal(notModifiedResponse.headers["cache-control"], "no-store");
    assert.equal(
      notModifiedResponse.headers["last-modified"],
      firstSupergraphResponse.headers["last-modified"],
    );

    const noopPublishResponse = await server.inject({
      headers: bearerHeaders(productsWriteToken, { "content-type": "text/plain" }),
      method: "POST",
      payload: productsSchema,
      url: "/v1/graphs/catalog/subgraphs/products/schema.graphqls",
    });
    assert.equal(noopPublishResponse.statusCode, 200);
    assert.equal(requirePublishPayload(parseJson(noopPublishResponse)).revision, "1");
    assert.equal(
      await queryCount(
        integrationDatabase.database.sql,
        `SELECT count(*)::int AS count FROM subgraph_schema_revisions WHERE subgraph_id = '${productsSubgraph.id}'`,
      ),
      1,
    );

    const invalidPublishResponse = await server.inject({
      headers: bearerHeaders(productsWriteToken, { "content-type": "text/plain" }),
      method: "POST",
      payload: "type Query {",
      url: "/v1/graphs/catalog/subgraphs/products/schema.graphqls",
    });
    assert.equal(invalidPublishResponse.statusCode, 422);
    assert.equal(
      await queryCount(
        integrationDatabase.database.sql,
        `SELECT count(*)::int AS count FROM subgraph_schema_revisions WHERE subgraph_id = '${productsSubgraph.id}'`,
      ),
      1,
    );

    const createReviewsResponse = await server.inject({
      headers: bearerHeaders(adminToken, { "content-type": "application/json" }),
      method: "POST",
      payload: {
        routingUrl: "https://reviews.example.com/graphql",
        slug: "reviews",
      },
      url: "/v1/graphs/catalog/subgraphs",
    });
    assert.equal(createReviewsResponse.statusCode, 201);
    const reviewsSubgraph = requireSubgraphPayload(parseJson(createReviewsResponse));

    const reviewsWriteToken = jwtSigner.createToken({
      authorization_details: [
        {
          graph_id: graph.id,
          scope: "subgraph:write",
          subgraph_id: reviewsSubgraph.id,
          type: authorizationDetailsType,
        },
      ],
    });

    const failedComposePublishResponse = await server.inject({
      headers: bearerHeaders(reviewsWriteToken, { "content-type": "text/plain" }),
      method: "POST",
      payload: incompatibleReviewsSchema,
      url: "/v1/graphs/catalog/subgraphs/reviews/schema.graphqls",
    });
    assert.equal(failedComposePublishResponse.statusCode, 201);
    assert.equal(requirePublishPayload(parseJson(failedComposePublishResponse)).revision, "1");

    const staleSupergraphResponse = await server.inject({
      headers: bearerHeaders(graphReadToken),
      method: "GET",
      url: "/v1/graphs/catalog/supergraph.graphqls",
    });
    assert.equal(staleSupergraphResponse.statusCode, 200);
    assert.equal(staleSupergraphResponse.headers.etag, firstSupergraphEtag);
    assert.equal(staleSupergraphResponse.body, firstSupergraphResponse.body);

    const successfulCompensationResponse = await server.inject({
      headers: bearerHeaders(reviewsWriteToken, { "content-type": "text/plain" }),
      method: "POST",
      payload: compatibleReviewsSchema,
      url: "/v1/graphs/catalog/subgraphs/reviews/schema.graphqls",
    });
    assert.equal(successfulCompensationResponse.statusCode, 201);
    assert.equal(requirePublishPayload(parseJson(successfulCompensationResponse)).revision, "2");

    const recomposedSupergraphResponse = await server.inject({
      headers: bearerHeaders(graphReadToken),
      method: "GET",
      url: "/v1/graphs/catalog/supergraph.graphqls",
    });
    assert.equal(recomposedSupergraphResponse.statusCode, 200);
    const recomposedGraph = await selectActiveGraphBySlug(
      integrationDatabase.database.database,
      "catalog",
    );
    assert.ok(recomposedGraph);
    const recomposedCompositionRevision = recomposedGraph.currentCompositionRevision;
    if (recomposedCompositionRevision === null) {
      throw new Error("Expected a current composition revision after recomposition.");
    }
    assert.equal(
      recomposedSupergraphResponse.headers.etag,
      formatStrongETag(graph.id, recomposedCompositionRevision),
    );
    assert.notEqual(recomposedSupergraphResponse.headers.etag, firstSupergraphEtag);
    assert.match(recomposedSupergraphResponse.body, /reviews/);

    const updatedRoutingUrlResponse = await server.inject({
      headers: bearerHeaders(adminToken, { "content-type": "application/json" }),
      method: "PUT",
      payload: {
        routingUrl: "https://reviews-v2.example.com/graphql",
      },
      url: "/v1/graphs/catalog/subgraphs/reviews",
    });
    assert.equal(updatedRoutingUrlResponse.statusCode, 200);

    const reroutedSupergraphResponse = await server.inject({
      headers: bearerHeaders(graphReadToken),
      method: "GET",
      url: "/v1/graphs/catalog/supergraph.graphqls",
    });
    assert.equal(reroutedSupergraphResponse.statusCode, 200);
    assert.match(reroutedSupergraphResponse.body, /reviews-v2\.example\.com/);

    const deleteReviewsResponse = await server.inject({
      headers: bearerHeaders(adminToken),
      method: "DELETE",
      url: "/v1/graphs/catalog/subgraphs/reviews",
    });
    assert.equal(deleteReviewsResponse.statusCode, 204);

    const fallbackToProductsResponse = await server.inject({
      headers: bearerHeaders(graphReadToken),
      method: "GET",
      url: "/v1/graphs/catalog/supergraph.graphqls",
    });
    assert.equal(fallbackToProductsResponse.statusCode, 200);
    assert.match(fallbackToProductsResponse.body, /type Product/);
    assert.doesNotMatch(fallbackToProductsResponse.body, /reviews-v2\.example\.com/);

    const deleteProductsResponse = await server.inject({
      headers: bearerHeaders(adminToken),
      method: "DELETE",
      url: "/v1/graphs/catalog/subgraphs/products",
    });
    assert.equal(deleteProductsResponse.statusCode, 204);

    const noSubgraphsSupergraphResponse = await server.inject({
      headers: bearerHeaders(graphReadToken),
      method: "GET",
      url: "/v1/graphs/catalog/supergraph.graphqls",
    });
    assert.equal(noSubgraphsSupergraphResponse.statusCode, 404);

    const invalidGraphVersionFormatResponse = await server.inject({
      headers: bearerHeaders(adminToken, { "content-type": "application/json" }),
      method: "PUT",
      payload: {
        federationVersion: "2.9",
      },
      url: "/v1/graphs/catalog",
    });
    assert.equal(invalidGraphVersionFormatResponse.statusCode, 400);

    const createFutureGraphResponse = await server.inject({
      headers: bearerHeaders(adminToken, { "content-type": "application/json" }),
      method: "POST",
      payload: {
        federationVersion: "v2.9",
        slug: "future-catalog",
      },
      url: "/v1/graphs",
    });
    assert.equal(createFutureGraphResponse.statusCode, 201);
    const futureGraph = requireGraphPayload(parseJson(createFutureGraphResponse));

    const createFutureProductsResponse = await server.inject({
      headers: bearerHeaders(adminToken, { "content-type": "application/json" }),
      method: "POST",
      payload: {
        routingUrl: "https://future-products.example.com/graphql",
        slug: "products",
      },
      url: "/v1/graphs/future-catalog/subgraphs",
    });
    assert.equal(createFutureProductsResponse.statusCode, 201);
    const futureProductsSubgraph = requireSubgraphPayload(parseJson(createFutureProductsResponse));

    const futureGraphReadToken = jwtSigner.createToken({
      authorization_details: [
        {
          graph_id: futureGraph.id,
          scope: "graph:read",
          type: authorizationDetailsType,
        },
      ],
    });
    const futureProductsWriteToken = jwtSigner.createToken({
      authorization_details: [
        {
          graph_id: futureGraph.id,
          scope: "subgraph:write",
          subgraph_id: futureProductsSubgraph.id,
          type: authorizationDetailsType,
        },
      ],
    });

    const publishFutureProductsResponse = await server.inject({
      headers: bearerHeaders(futureProductsWriteToken, { "content-type": "text/plain" }),
      method: "POST",
      payload: futureProductsSchema,
      url: "/v1/graphs/future-catalog/subgraphs/products/schema.graphqls",
    });
    assert.equal(publishFutureProductsResponse.statusCode, 201);
    assert.equal(requirePublishPayload(parseJson(publishFutureProductsResponse)).revision, "1");

    const cappedSupergraphResponse = await server.inject({
      headers: bearerHeaders(futureGraphReadToken),
      method: "GET",
      url: "/v1/graphs/future-catalog/supergraph.graphqls",
    });
    assert.equal(cappedSupergraphResponse.statusCode, 404);

    const upgradeFutureGraphResponse = await server.inject({
      headers: bearerHeaders(adminToken, { "content-type": "application/json" }),
      method: "PUT",
      payload: {
        federationVersion: "v2.13",
      },
      url: "/v1/graphs/future-catalog",
    });
    assert.equal(upgradeFutureGraphResponse.statusCode, 200);

    const upgradedSupergraphResponse = await server.inject({
      headers: bearerHeaders(futureGraphReadToken),
      method: "GET",
      url: "/v1/graphs/future-catalog/supergraph.graphqls",
    });
    assert.equal(upgradedSupergraphResponse.statusCode, 200);
    assert.match(upgradedSupergraphResponse.body, /type Product/);

    const unsupportedGraphVersionResponse = await server.inject({
      headers: bearerHeaders(adminToken, { "content-type": "application/json" }),
      method: "PUT",
      payload: {
        federationVersion: "v999.999",
      },
      url: "/v1/graphs/catalog",
    });
    assert.equal(unsupportedGraphVersionResponse.statusCode, 422);
  } finally {
    await server.close();
    await integrationDatabase.close();
  }
});
