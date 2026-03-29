import assert from "node:assert/strict";
import test from "node:test";

import {
  composeSupergraph,
  isSupportedFederationVersion,
  validateSubgraphSchema,
} from "./federation.ts";

await test("federation helpers", async (t) => {
  await t.test("recognizes supported federation versions", () => {
    assert.equal(isSupportedFederationVersion("v2.9"), true);
    assert.equal(isSupportedFederationVersion("2.9"), false);
    assert.equal(isSupportedFederationVersion("2"), false);
    assert.equal(isSupportedFederationVersion("not-a-version"), false);
  });

  await t.test("canonicalizes valid subgraph SDL", () => {
    const result = validateSubgraphSchema(
      "products",
      "https://products.example.com/graphql",
      [
        'extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])',
        "",
        'type Product @key(fields: "id") {',
        "  name: String!",
        "  id: ID!",
        "}",
        "",
        "type Query {",
        "  product(id: ID!): Product",
        "}",
      ].join("\n"),
    );

    if (!result.ok) {
      assert.fail("Expected SDL validation to succeed.");
    }

    assert.match(result.value.normalizedSdl, /@key\(fields: "id"\)/);
    assert.equal(result.value.normalizedSdl.includes("\r\n"), false);
    assert.match(result.value.normalizedHash, /^[0-9a-f]{64}$/);
  });

  await t.test("rejects invalid subgraph SDL", () => {
    const result = validateSubgraphSchema(
      "products",
      "https://products.example.com/graphql",
      "type Query {",
    );

    assert.deepEqual(result, { ok: false });
  });

  await t.test("composes deterministically by subgraph name", () => {
    const products = validateSubgraphSchema(
      "products",
      "https://products.example.com/graphql",
      [
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
      ].join("\n"),
    );
    const reviews = validateSubgraphSchema(
      "reviews",
      "https://reviews.example.com/graphql",
      [
        'extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])',
        "",
        "type Review {",
        "  id: ID!",
        "  body: String!",
        "}",
        "",
        "type Query {",
        "  topReview: Review",
        "}",
      ].join("\n"),
    );

    if (!products.ok || !reviews.ok) {
      assert.fail("Expected SDL validation to succeed.");
    }

    const forward = composeSupergraph({
      federationVersion: "v2.9",
      subgraphs: [
        {
          name: "reviews",
          sdl: reviews.value.normalizedSdl,
          url: "https://reviews.example.com/graphql",
        },
        {
          name: "products",
          sdl: products.value.normalizedSdl,
          url: "https://products.example.com/graphql",
        },
      ],
    });
    const reverse = composeSupergraph({
      federationVersion: "v2.9",
      subgraphs: [
        {
          name: "products",
          sdl: products.value.normalizedSdl,
          url: "https://products.example.com/graphql",
        },
        {
          name: "reviews",
          sdl: reviews.value.normalizedSdl,
          url: "https://reviews.example.com/graphql",
        },
      ],
    });

    if (forward.kind !== "success" || reverse.kind !== "success") {
      assert.fail("Expected supergraph composition to succeed.");
    }

    assert.equal(forward.supergraphSdl, reverse.supergraphSdl);
  });

  await t.test("targets the graph federation version during composition", () => {
    const products = validateSubgraphSchema(
      "products",
      "https://products.example.com/graphql",
      [
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
      ].join("\n"),
    );

    if (!products.ok) {
      assert.fail("Expected SDL validation to succeed.");
    }

    const result = composeSupergraph({
      federationVersion: "v2.10",
      subgraphs: [
        {
          name: "products",
          sdl: products.value.normalizedSdl,
          url: "https://products.example.com/graphql",
        },
      ],
    });

    if (result.kind !== "success") {
      assert.fail("Expected supergraph composition to succeed.");
    }

    assert.match(result.supergraphSdl, /specs\.apollo\.dev\/join\/v0\.5/);
  });

  await t.test("fails when a subgraph requires a newer federation version", () => {
    const products = validateSubgraphSchema(
      "products",
      "https://products.example.com/graphql",
      [
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
      ].join("\n"),
    );

    if (!products.ok) {
      assert.fail("Expected SDL validation to succeed.");
    }

    assert.deepEqual(
      composeSupergraph({
        federationVersion: "v2.9",
        subgraphs: [
          {
            name: "products",
            sdl: products.value.normalizedSdl,
            url: "https://products.example.com/graphql",
          },
        ],
      }),
      {
        kind: "failure",
      },
    );
  });
});
