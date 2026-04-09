// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import { normalizeSchemaSdl } from "./domain/subgraph-schema.ts";
import {
  adminHeaders,
  authorizationHeaders,
  parseJson,
  createIntegrationServerFixture,
} from "./test-support/integration-server.ts";
import { requireGraphPayload, requireSubgraphPayload } from "./test-support/payloads.ts";

const inventorySchemaSdl = `
  type Query {
    products: [String!]!
  }
`;

const conflictingProductsSchemaSdl = `
  type Query {
    products: [Int!]!
  }
`;

type IntegrationFixture = Awaited<ReturnType<typeof createIntegrationServerFixture>>;
type GraphCompositionSnapshot = {
  currentCompositionRevision: string | null;
  currentSupergraphSchemaRevision: string | null;
  compositionRevisions: string[];
  supergraphSchemaRevisions: string[];
  members: Array<{
    compositionRevision: string;
    subgraphId: string;
    subgraphRevision: string;
    subgraphSchemaRevision: string;
  }>;
};

function sortGraphCompositionMembers(
  members: GraphCompositionSnapshot["members"],
): GraphCompositionSnapshot["members"] {
  return members.toSorted(
    (left, right) =>
      Number(left.compositionRevision) - Number(right.compositionRevision) ||
      left.subgraphId.localeCompare(right.subgraphId),
  );
}

function createSubgraphSchemaGrantToken(
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
  fixture: IntegrationFixture,
  adminToken: string,
  slug: string,
): Promise<ReturnType<typeof requireGraphPayload>> {
  const response = await fixture.server.inject({
    headers: adminHeaders(adminToken),
    method: "POST",
    payload: { slug },
    url: "/v1/graphs",
  });
  assert.equal(response.statusCode, 201);
  return requireGraphPayload(parseJson(response));
}

async function createSubgraph(
  fixture: IntegrationFixture,
  adminToken: string,
  graphSlug: string,
  slug: string,
  routingUrl: string,
): Promise<ReturnType<typeof requireSubgraphPayload>> {
  const response = await fixture.server.inject({
    headers: adminHeaders(adminToken),
    method: "POST",
    payload: { routingUrl, slug },
    url: `/v1/graphs/${graphSlug}/subgraphs`,
  });
  assert.equal(response.statusCode, 201);
  return requireSubgraphPayload(parseJson(response));
}

async function publishSubgraphSchema(
  fixture: IntegrationFixture,
  createToken: ReturnType<typeof createAuthJwtSigner>["createToken"],
  graph: ReturnType<typeof requireGraphPayload>,
  subgraph: ReturnType<typeof requireSubgraphPayload>,
  schemaSdl: string,
): Promise<void> {
  const schemaWriteToken = createSubgraphSchemaGrantToken(createToken, graph.id, subgraph.id);
  const response = await fixture.server.inject({
    headers: {
      ...authorizationHeaders(schemaWriteToken),
      "content-type": "text/plain",
    },
    method: "POST",
    payload: schemaSdl,
    url: `/v1/graphs/${graph.slug}/subgraphs/${subgraph.slug}/schema.graphqls`,
  });
  assert.equal(response.statusCode, 204);
}

async function updateSubgraphRoutingUrl(
  fixture: IntegrationFixture,
  adminToken: string,
  graphSlug: string,
  subgraphSlug: string,
  routingUrl: string,
): Promise<void> {
  const response = await fixture.server.inject({
    headers: adminHeaders(adminToken),
    method: "PUT",
    payload: { routingUrl },
    url: `/v1/graphs/${graphSlug}/subgraphs/${subgraphSlug}`,
  });
  assert.equal(response.statusCode, 200);
}

async function deleteSubgraph(
  fixture: IntegrationFixture,
  adminToken: string,
  graphSlug: string,
  subgraphSlug: string,
): Promise<void> {
  const response = await fixture.server.inject({
    headers: adminHeaders(adminToken),
    method: "DELETE",
    url: `/v1/graphs/${graphSlug}/subgraphs/${subgraphSlug}`,
  });
  assert.equal(response.statusCode, 204);
}

async function selectGraphCompositionSnapshot(
  fixture: IntegrationFixture,
  graphId: string,
): Promise<GraphCompositionSnapshot> {
  const [graphRow] = await fixture.sql<
    Array<{
      currentCompositionRevision: bigint | string | null;
      currentSupergraphSchemaRevision: bigint | string | null;
    }>
  >`
    SELECT
      current_composition_revision AS "currentCompositionRevision",
      current_supergraph_schema_revision AS "currentSupergraphSchemaRevision"
    FROM graphs
    WHERE id = ${graphId}
  `;
  assert.ok(graphRow);

  const compositionRows = await fixture.sql<
    Array<{
      revision: bigint | string;
    }>
  >`
    SELECT revision
    FROM graph_compositions
    WHERE graph_id = ${graphId}
    ORDER BY revision
  `;

  const supergraphSchemaRows = await fixture.sql<
    Array<{
      compositionRevision: bigint | string;
    }>
  >`
    SELECT composition_revision AS "compositionRevision"
    FROM supergraph_schemas
    WHERE graph_id = ${graphId}
    ORDER BY composition_revision
  `;

  const memberRows = await fixture.sql<
    Array<{
      compositionRevision: bigint | string;
      subgraphId: string;
      subgraphRevision: bigint | string;
      subgraphSchemaRevision: bigint | string;
    }>
  >`
    SELECT
      composition_revision AS "compositionRevision",
      subgraph_id AS "subgraphId",
      subgraph_revision AS "subgraphRevision",
      subgraph_schema_revision AS "subgraphSchemaRevision"
    FROM graph_composition_subgraphs
    WHERE graph_id = ${graphId}
    ORDER BY composition_revision, subgraph_id
  `;

  return {
    currentCompositionRevision:
      graphRow.currentCompositionRevision === null
        ? null
        : String(graphRow.currentCompositionRevision),
    currentSupergraphSchemaRevision:
      graphRow.currentSupergraphSchemaRevision === null
        ? null
        : String(graphRow.currentSupergraphSchemaRevision),
    compositionRevisions: compositionRows.map((row) => String(row.revision)),
    supergraphSchemaRevisions: supergraphSchemaRows.map((row) => String(row.compositionRevision)),
    members: memberRows.map((row) => ({
      compositionRevision: String(row.compositionRevision),
      subgraphId: row.subgraphId,
      subgraphRevision: String(row.subgraphRevision),
      subgraphSchemaRevision: String(row.subgraphSchemaRevision),
    })),
  };
}

await test("graph composition integration with postgres", async (t) => {
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

  await t.test("stores a successful composition after schema publish", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification: jwtSigner.jwtVerification,
    });

    try {
      const createdGraph = await createGraph(fixture, adminToken, "catalog");
      const createdSubgraph = await createSubgraph(
        fixture,
        adminToken,
        createdGraph.slug,
        "inventory",
        "https://inventory.example.com/graphql",
      );
      await publishSubgraphSchema(
        fixture,
        jwtSigner.createToken,
        createdGraph,
        createdSubgraph,
        inventorySchemaSdl,
      );

      assert.deepEqual(await selectGraphCompositionSnapshot(fixture, createdGraph.id), {
        currentCompositionRevision: "1",
        currentSupergraphSchemaRevision: "1",
        compositionRevisions: ["1"],
        supergraphSchemaRevisions: ["1"],
        members: [
          {
            compositionRevision: "1",
            subgraphId: createdSubgraph.id,
            subgraphRevision: "1",
            subgraphSchemaRevision: "1",
          },
        ],
      });

      const [supergraphSchemaRow] = await fixture.sql<
        Array<{
          supergraphSdl: string;
        }>
      >`
        SELECT supergraph_sdl AS "supergraphSdl"
        FROM supergraph_schemas
        WHERE graph_id = ${createdGraph.id}
      `;
      assert.ok(supergraphSchemaRow);
      assert.match(String(supergraphSchemaRow.supergraphSdl), /join__Graph/);
      assert.match(String(supergraphSchemaRow.supergraphSdl), /inventory\.example\.com\/graphql/);
    } finally {
      await fixture.close();
    }
  });

  await t.test(
    "keeps the previous current supergraph schema when recomposition fails",
    async () => {
      const fixture = await createIntegrationServerFixture({
        databaseUrl: integrationDatabaseUrl,
        jwtVerification: jwtSigner.jwtVerification,
      });

      try {
        const createdGraph = await createGraph(fixture, adminToken, "catalog");
        const inventorySubgraph = await createSubgraph(
          fixture,
          adminToken,
          createdGraph.slug,
          "inventory",
          "https://inventory.example.com/graphql",
        );
        await publishSubgraphSchema(
          fixture,
          jwtSigner.createToken,
          createdGraph,
          inventorySubgraph,
          inventorySchemaSdl,
        );
        const warehouseSubgraph = await createSubgraph(
          fixture,
          adminToken,
          createdGraph.slug,
          "warehouse",
          "https://warehouse.example.com/graphql",
        );
        await publishSubgraphSchema(
          fixture,
          jwtSigner.createToken,
          createdGraph,
          warehouseSubgraph,
          conflictingProductsSchemaSdl,
        );

        assert.deepEqual(await selectGraphCompositionSnapshot(fixture, createdGraph.id), {
          currentCompositionRevision: "2",
          currentSupergraphSchemaRevision: "1",
          compositionRevisions: ["1", "2"],
          supergraphSchemaRevisions: ["1"],
          members: sortGraphCompositionMembers([
            {
              compositionRevision: "1",
              subgraphId: inventorySubgraph.id,
              subgraphRevision: "1",
              subgraphSchemaRevision: "1",
            },
            {
              compositionRevision: "2",
              subgraphId: inventorySubgraph.id,
              subgraphRevision: "1",
              subgraphSchemaRevision: "1",
            },
            {
              compositionRevision: "2",
              subgraphId: warehouseSubgraph.id,
              subgraphRevision: "1",
              subgraphSchemaRevision: "1",
            },
          ]),
        });

        const [warehouseSchemaRow] = await fixture.sql<
          Array<{
            currentSchemaRevision: bigint | string | null;
            normalizedSdl: string;
          }>
        >`
        SELECT
          s.current_schema_revision AS "currentSchemaRevision",
          ssr.normalized_sdl AS "normalizedSdl"
        FROM subgraphs AS s
        JOIN subgraph_schema_revisions AS ssr
          ON ssr.subgraph_id = s.id AND ssr.revision = s.current_schema_revision
        WHERE s.id = ${warehouseSubgraph.id}
      `;
        assert.ok(warehouseSchemaRow);
        assert.equal(String(warehouseSchemaRow.currentSchemaRevision), "1");
        assert.equal(
          warehouseSchemaRow.normalizedSdl,
          normalizeSchemaSdl(conflictingProductsSchemaSdl),
        );
      } finally {
        await fixture.close();
      }
    },
  );

  await t.test(
    "clears both graph composition pointers when the final member is deleted",
    async () => {
      const fixture = await createIntegrationServerFixture({
        databaseUrl: integrationDatabaseUrl,
        jwtVerification: jwtSigner.jwtVerification,
      });

      try {
        const createdGraph = await createGraph(fixture, adminToken, "catalog");
        const createdSubgraph = await createSubgraph(
          fixture,
          adminToken,
          createdGraph.slug,
          "inventory",
          "https://inventory.example.com/graphql",
        );
        await publishSubgraphSchema(
          fixture,
          jwtSigner.createToken,
          createdGraph,
          createdSubgraph,
          inventorySchemaSdl,
        );
        await deleteSubgraph(fixture, adminToken, createdGraph.slug, createdSubgraph.slug);

        assert.deepEqual(await selectGraphCompositionSnapshot(fixture, createdGraph.id), {
          currentCompositionRevision: null,
          currentSupergraphSchemaRevision: null,
          compositionRevisions: ["1"],
          supergraphSchemaRevisions: ["1"],
          members: [
            {
              compositionRevision: "1",
              subgraphId: createdSubgraph.id,
              subgraphRevision: "1",
              subgraphSchemaRevision: "1",
            },
          ],
        });
      } finally {
        await fixture.close();
      }
    },
  );

  await t.test(
    "does not recompose when a schema-less subgraph changes routing after a failed attempt",
    async () => {
      const fixture = await createIntegrationServerFixture({
        databaseUrl: integrationDatabaseUrl,
        jwtVerification: jwtSigner.jwtVerification,
      });

      try {
        const createdGraph = await createGraph(fixture, adminToken, "catalog");
        const inventorySubgraph = await createSubgraph(
          fixture,
          adminToken,
          createdGraph.slug,
          "inventory",
          "https://inventory.example.com/graphql",
        );
        await publishSubgraphSchema(
          fixture,
          jwtSigner.createToken,
          createdGraph,
          inventorySubgraph,
          inventorySchemaSdl,
        );
        const warehouseSubgraph = await createSubgraph(
          fixture,
          adminToken,
          createdGraph.slug,
          "warehouse",
          "https://warehouse.example.com/graphql",
        );
        await publishSubgraphSchema(
          fixture,
          jwtSigner.createToken,
          createdGraph,
          warehouseSubgraph,
          conflictingProductsSchemaSdl,
        );
        await createSubgraph(
          fixture,
          adminToken,
          createdGraph.slug,
          "logistics",
          "https://logistics-v1.example.com/graphql",
        );
        await updateSubgraphRoutingUrl(
          fixture,
          adminToken,
          createdGraph.slug,
          "logistics",
          "https://logistics-v2.example.com/graphql",
        );

        assert.deepEqual(await selectGraphCompositionSnapshot(fixture, createdGraph.id), {
          currentCompositionRevision: "2",
          currentSupergraphSchemaRevision: "1",
          compositionRevisions: ["1", "2"],
          supergraphSchemaRevisions: ["1"],
          members: sortGraphCompositionMembers([
            {
              compositionRevision: "1",
              subgraphId: inventorySubgraph.id,
              subgraphRevision: "1",
              subgraphSchemaRevision: "1",
            },
            {
              compositionRevision: "2",
              subgraphId: inventorySubgraph.id,
              subgraphRevision: "1",
              subgraphSchemaRevision: "1",
            },
            {
              compositionRevision: "2",
              subgraphId: warehouseSubgraph.id,
              subgraphRevision: "1",
              subgraphSchemaRevision: "1",
            },
          ]),
        });
      } finally {
        await fixture.close();
      }
    },
  );

  await t.test(
    "uses a new composition revision after clearing graph composition pointers",
    async () => {
      const fixture = await createIntegrationServerFixture({
        databaseUrl: integrationDatabaseUrl,
        jwtVerification: jwtSigner.jwtVerification,
      });

      try {
        const createdGraph = await createGraph(fixture, adminToken, "catalog");
        const firstSubgraph = await createSubgraph(
          fixture,
          adminToken,
          createdGraph.slug,
          "inventory",
          "https://inventory.example.com/graphql",
        );
        await publishSubgraphSchema(
          fixture,
          jwtSigner.createToken,
          createdGraph,
          firstSubgraph,
          inventorySchemaSdl,
        );
        await deleteSubgraph(fixture, adminToken, createdGraph.slug, firstSubgraph.slug);

        const secondSubgraph = await createSubgraph(
          fixture,
          adminToken,
          createdGraph.slug,
          "warehouse",
          "https://warehouse.example.com/graphql",
        );
        await publishSubgraphSchema(
          fixture,
          jwtSigner.createToken,
          createdGraph,
          secondSubgraph,
          inventorySchemaSdl,
        );

        assert.deepEqual(await selectGraphCompositionSnapshot(fixture, createdGraph.id), {
          currentCompositionRevision: "2",
          currentSupergraphSchemaRevision: "2",
          compositionRevisions: ["1", "2"],
          supergraphSchemaRevisions: ["1", "2"],
          members: sortGraphCompositionMembers([
            {
              compositionRevision: "1",
              subgraphId: firstSubgraph.id,
              subgraphRevision: "1",
              subgraphSchemaRevision: "1",
            },
            {
              compositionRevision: "2",
              subgraphId: secondSubgraph.id,
              subgraphRevision: "1",
              subgraphSchemaRevision: "1",
            },
          ]),
        });
      } finally {
        await fixture.close();
      }
    },
  );
});
