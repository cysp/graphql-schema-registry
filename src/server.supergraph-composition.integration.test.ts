// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import { queryCount } from "./test-support/database.ts";
import {
  adminHeaders,
  authorizationHeaders,
  createIntegrationServerFixture,
  parseJson,
} from "./test-support/integration-server.ts";
import { requireGraphPayload, requireSubgraphPayload } from "./test-support/payloads.ts";

const schemaA1 = `
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.13", import: ["@key"])

  type Query {
    topProducts: [Product!]!
  }

  type Product @key(fields: "id") {
    id: ID!
    name: String
  }
`;

const schemaB1 = `
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.13", import: ["@external", "@key"])

  extend type Product @key(fields: "id") {
    id: ID! @external
    price: Int
  }
`;

const schemaB2Breaking = `
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.13", import: ["@key"])

  type Product @key(fields: "id") {
    id: ID!
    name: Int
  }
`;

const schemaC1 = `
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.13", import: ["@external", "@key"])

  extend type Product @key(fields: "id") {
    id: ID! @external
    weight: Int
  }
`;

const schemaC2 = `
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.13", import: ["@external", "@key"])

  extend type Product @key(fields: "id") {
    id: ID! @external
    weight: Int
    sku: String
  }
`;

function createSubgraphSchemaWriteToken(
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
  server: Awaited<ReturnType<typeof createIntegrationServerFixture>>["server"],
  adminToken: string,
  slug = "catalog",
) {
  const response = await server.inject({
    headers: adminHeaders(adminToken),
    method: "POST",
    payload: { slug },
    url: "/v1/graphs",
  });
  assert.equal(response.statusCode, 201);
  return requireGraphPayload(parseJson(response));
}

async function createSubgraph(
  server: Awaited<ReturnType<typeof createIntegrationServerFixture>>["server"],
  adminToken: string,
  graphSlug: string,
  slug: string,
  routingUrl: string,
) {
  const response = await server.inject({
    headers: adminHeaders(adminToken),
    method: "POST",
    payload: {
      routingUrl,
      slug,
    },
    url: `/v1/graphs/${encodeURIComponent(graphSlug)}/subgraphs`,
  });
  assert.equal(response.statusCode, 201);
  return requireSubgraphPayload(parseJson(response));
}

async function publishSubgraphSchema(
  server: Awaited<ReturnType<typeof createIntegrationServerFixture>>["server"],
  schemaWriteToken: string,
  graphSlug: string,
  subgraphSlug: string,
  schemaSdl: string,
) {
  const response = await server.inject({
    headers: {
      ...authorizationHeaders(schemaWriteToken),
      "content-type": "text/plain",
    },
    method: "POST",
    payload: schemaSdl,
    url: `/v1/graphs/${encodeURIComponent(graphSlug)}/subgraphs/${encodeURIComponent(subgraphSlug)}/schema.graphqls`,
  });
  assert.equal(response.statusCode, 204);
}

async function queryGraphCompositionState(
  sql: Awaited<ReturnType<typeof createIntegrationServerFixture>>["sql"],
  graphId: string,
) {
  const [state] = await sql<
    Array<{
      currentSupergraphSchemaRevision: string | null;
    }>
  >`
    SELECT
      current_supergraph_schema_revision AS "currentSupergraphSchemaRevision"
    FROM graphs
    WHERE id = ${graphId}
  `;

  assert.ok(state);
  return state;
}

async function queryCompositionMembers(
  sql: Awaited<ReturnType<typeof createIntegrationServerFixture>>["sql"],
  graphId: string,
  supergraphSchemaRevision: bigint,
) {
  return Array.from(
    await sql<
      Array<{
        subgraphId: string;
        subgraphRevision: bigint;
        subgraphSchemaRevision: bigint;
      }>
    >`
    SELECT
      ssm.subgraph_id AS "subgraphId",
      ssm.subgraph_revision AS "subgraphRevision",
      ssm.subgraph_schema_revision AS "subgraphSchemaRevision"
    FROM supergraph_schema_revision_subgraphs AS ssm
    JOIN subgraphs AS s
      ON s.id = ssm.subgraph_id
    WHERE ssm.graph_id = ${graphId}
      AND ssm.supergraph_schema_revision = ${String(supergraphSchemaRevision)}
    ORDER BY s.slug
  `,
  );
}

await test("supergraph composition persistence integration with postgres", async (t) => {
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

  await t.test(
    "keeps the latest successful supergraph pinned when later eligible snapshots fail",
    async () => {
      const fixture = await createIntegrationServerFixture({
        databaseUrl: integrationDatabaseUrl,
        jwtVerification: jwtSigner.jwtVerification,
      });

      try {
        const graph = await createGraph(fixture.server, adminToken);
        const subgraphA = await createSubgraph(
          fixture.server,
          adminToken,
          "catalog",
          "a",
          "https://a.example.com/graphql",
        );
        const subgraphB = await createSubgraph(
          fixture.server,
          adminToken,
          "catalog",
          "b",
          "https://b.example.com/graphql",
        );
        const subgraphC = await createSubgraph(
          fixture.server,
          adminToken,
          "catalog",
          "c",
          "https://c.example.com/graphql",
        );

        assert.deepEqual(await queryGraphCompositionState(fixture.sql, graph.id), {
          currentSupergraphSchemaRevision: null,
        });

        await publishSubgraphSchema(
          fixture.server,
          createSubgraphSchemaWriteToken(jwtSigner.createToken, graph.id, subgraphA.id),
          "catalog",
          "a",
          schemaA1,
        );
        await publishSubgraphSchema(
          fixture.server,
          createSubgraphSchemaWriteToken(jwtSigner.createToken, graph.id, subgraphB.id),
          "catalog",
          "b",
          schemaB1,
        );
        await publishSubgraphSchema(
          fixture.server,
          createSubgraphSchemaWriteToken(jwtSigner.createToken, graph.id, subgraphC.id),
          "catalog",
          "c",
          schemaC1,
        );

        assert.deepEqual(await queryGraphCompositionState(fixture.sql, graph.id), {
          currentSupergraphSchemaRevision: "3",
        });
        assert.equal(
          await queryCount(
            fixture.sql,
            "SELECT count(*)::int AS count FROM supergraph_schema_revisions WHERE graph_id = $1",
            [graph.id],
          ),
          3,
        );

        await publishSubgraphSchema(
          fixture.server,
          createSubgraphSchemaWriteToken(jwtSigner.createToken, graph.id, subgraphB.id),
          "catalog",
          "b",
          schemaB2Breaking,
        );

        assert.deepEqual(await queryGraphCompositionState(fixture.sql, graph.id), {
          currentSupergraphSchemaRevision: "3",
        });
        assert.equal(
          await queryCount(
            fixture.sql,
            "SELECT count(*)::int AS count FROM supergraph_schema_revisions WHERE graph_id = $1",
            [graph.id],
          ),
          3,
        );
        assert.deepEqual(await queryCompositionMembers(fixture.sql, graph.id, 3n), [
          {
            subgraphId: subgraphA.id,
            subgraphRevision: "1",
            subgraphSchemaRevision: "1",
          },
          {
            subgraphId: subgraphB.id,
            subgraphRevision: "1",
            subgraphSchemaRevision: "1",
          },
          {
            subgraphId: subgraphC.id,
            subgraphRevision: "1",
            subgraphSchemaRevision: "1",
          },
        ]);

        await publishSubgraphSchema(
          fixture.server,
          createSubgraphSchemaWriteToken(jwtSigner.createToken, graph.id, subgraphC.id),
          "catalog",
          "c",
          schemaC2,
        );

        assert.deepEqual(await queryGraphCompositionState(fixture.sql, graph.id), {
          currentSupergraphSchemaRevision: "3",
        });
        assert.equal(
          await queryCount(
            fixture.sql,
            "SELECT count(*)::int AS count FROM supergraph_schema_revisions WHERE graph_id = $1",
            [graph.id],
          ),
          3,
        );
        assert.deepEqual(await queryCompositionMembers(fixture.sql, graph.id, 3n), [
          {
            subgraphId: subgraphA.id,
            subgraphRevision: "1",
            subgraphSchemaRevision: "1",
          },
          {
            subgraphId: subgraphB.id,
            subgraphRevision: "1",
            subgraphSchemaRevision: "1",
          },
          {
            subgraphId: subgraphC.id,
            subgraphRevision: "1",
            subgraphSchemaRevision: "1",
          },
        ]);

        const deleteResponse = await fixture.server.inject({
          headers: adminHeaders(adminToken),
          method: "DELETE",
          url: "/v1/graphs/catalog/subgraphs/b",
        });
        assert.equal(deleteResponse.statusCode, 204);

        assert.deepEqual(await queryGraphCompositionState(fixture.sql, graph.id), {
          currentSupergraphSchemaRevision: "4",
        });
        assert.equal(
          await queryCount(
            fixture.sql,
            "SELECT count(*)::int AS count FROM supergraph_schema_revisions WHERE graph_id = $1",
            [graph.id],
          ),
          4,
        );
        assert.deepEqual(await queryCompositionMembers(fixture.sql, graph.id, 4n), [
          {
            subgraphId: subgraphA.id,
            subgraphRevision: "1",
            subgraphSchemaRevision: "1",
          },
          {
            subgraphId: subgraphC.id,
            subgraphRevision: "1",
            subgraphSchemaRevision: "2",
          },
        ]);
      } finally {
        await fixture.close();
      }
    },
  );

  await t.test(
    "stores a new supergraph revision when composition succeeds with unchanged schema hash",
    async () => {
      const fixture = await createIntegrationServerFixture({
        databaseUrl: integrationDatabaseUrl,
        jwtVerification: jwtSigner.jwtVerification,
      });

      try {
        const graph = await createGraph(fixture.server, adminToken);
        const subgraph = await createSubgraph(
          fixture.server,
          adminToken,
          "catalog",
          "inventory",
          "https://inventory-v1.example.com/graphql",
        );

        await publishSubgraphSchema(
          fixture.server,
          createSubgraphSchemaWriteToken(jwtSigner.createToken, graph.id, subgraph.id),
          "catalog",
          "inventory",
          schemaA1,
        );

        assert.deepEqual(await queryGraphCompositionState(fixture.sql, graph.id), {
          currentSupergraphSchemaRevision: "1",
        });

        const updateResponse = await fixture.server.inject({
          headers: adminHeaders(adminToken),
          method: "PUT",
          payload: {
            routingUrl: "https://inventory-v2.example.com/graphql",
          },
          url: "/v1/graphs/catalog/subgraphs/inventory",
        });
        assert.equal(updateResponse.statusCode, 200);

        assert.deepEqual(await queryGraphCompositionState(fixture.sql, graph.id), {
          currentSupergraphSchemaRevision: "2",
        });
        assert.equal(
          await queryCount(
            fixture.sql,
            "SELECT count(*)::int AS count FROM supergraph_schema_revisions WHERE graph_id = $1",
            [graph.id],
          ),
          2,
        );
        assert.deepEqual(await queryCompositionMembers(fixture.sql, graph.id, 2n), [
          {
            subgraphId: subgraph.id,
            subgraphRevision: "2",
            subgraphSchemaRevision: "1",
          },
        ]);
      } finally {
        await fixture.close();
      }
    },
  );

  await t.test(
    "clears the current supergraph revision when the latest eligible set is empty",
    async () => {
      const fixture = await createIntegrationServerFixture({
        databaseUrl: integrationDatabaseUrl,
        jwtVerification: jwtSigner.jwtVerification,
      });

      try {
        const graph = await createGraph(fixture.server, adminToken);
        const subgraph = await createSubgraph(
          fixture.server,
          adminToken,
          "catalog",
          "inventory",
          "https://inventory.example.com/graphql",
        );

        await publishSubgraphSchema(
          fixture.server,
          createSubgraphSchemaWriteToken(jwtSigner.createToken, graph.id, subgraph.id),
          "catalog",
          "inventory",
          schemaA1,
        );

        const deleteResponse = await fixture.server.inject({
          headers: adminHeaders(adminToken),
          method: "DELETE",
          url: "/v1/graphs/catalog/subgraphs/inventory",
        });
        assert.equal(deleteResponse.statusCode, 204);

        assert.deepEqual(await queryGraphCompositionState(fixture.sql, graph.id), {
          currentSupergraphSchemaRevision: null,
        });
        assert.equal(
          await queryCount(
            fixture.sql,
            "SELECT count(*)::int AS count FROM supergraph_schema_revisions WHERE graph_id = $1",
            [graph.id],
          ),
          1,
        );
        assert.deepEqual(await queryCompositionMembers(fixture.sql, graph.id, 1n), [
          {
            subgraphId: subgraph.id,
            subgraphRevision: "1",
            subgraphSchemaRevision: "1",
          },
        ]);
      } finally {
        await fixture.close();
      }
    },
  );
});
