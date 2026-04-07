// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { connectIntegrationDatabase } from "../../test-support/database.ts";
import { hashNormalizedSchemaSdl } from "../subgraph-schema.ts";

await test("revision foreign keys", async (t) => {
  const integrationDatabaseUrl = process.env["INTEGRATION_TEST_DATABASE_URL"]?.trim();
  if (!integrationDatabaseUrl) {
    t.skip("INTEGRATION_TEST_DATABASE_URL is not configured");
    return;
  }

  await t.test("graph revision constraints are deferred and enforced", async () => {
    const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);

    try {
      const graphId = randomUUID();
      const now = new Date().toISOString();

      await integrationDatabase.database.sql.begin(async (sql) => {
        await sql.unsafe(`
          INSERT INTO graphs (id, slug, current_revision, created_at, updated_at)
          VALUES ('${graphId}', 'catalog', 1, '${now}', '${now}')
        `);
        await sql.unsafe(`
          INSERT INTO graph_revisions (graph_id, revision, created_at)
          VALUES ('${graphId}', 1, '${now}')
        `);
      });

      await assert.rejects(
        integrationDatabase.database.sql`
          UPDATE graphs
          SET current_revision = 2
          WHERE id = ${graphId}
        `,
        /fk_g__cur_rev__gr/,
      );
    } finally {
      await integrationDatabase.close();
    }
  });

  await t.test("subgraph revision constraints are deferred and enforced", async () => {
    const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);

    try {
      const graphId = randomUUID();
      const subgraphId = randomUUID();
      const now = new Date().toISOString();

      await integrationDatabase.database.sql.begin(async (sql) => {
        await sql.unsafe(`
          INSERT INTO graphs (id, slug, current_revision, created_at, updated_at)
          VALUES ('${graphId}', 'catalog', 1, '${now}', '${now}')
        `);
        await sql.unsafe(`
          INSERT INTO graph_revisions (graph_id, revision, created_at)
          VALUES ('${graphId}', 1, '${now}')
        `);
      });

      await integrationDatabase.database.sql.begin(async (sql) => {
        await sql.unsafe(`
          INSERT INTO subgraphs (id, graph_id, slug, current_revision, created_at, updated_at)
          VALUES ('${subgraphId}', '${graphId}', 'inventory', 1, '${now}', '${now}')
        `);
        await sql.unsafe(`
          INSERT INTO subgraph_revisions (subgraph_id, revision, routing_url, created_at)
          VALUES ('${subgraphId}', 1, 'https://inventory.example.com/graphql', '${now}')
        `);
      });

      await assert.rejects(
        integrationDatabase.database.sql`
          UPDATE subgraphs
          SET current_revision = 2
          WHERE id = ${subgraphId}
        `,
        /fk_sg__cur_rev__sgr/,
      );
    } finally {
      await integrationDatabase.close();
    }
  });

  await t.test("subgraph schema revision constraints are deferred and enforced", async () => {
    const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);

    try {
      const graphId = randomUUID();
      const subgraphId = randomUUID();
      const now = new Date().toISOString();
      const normalizedSdl = "type Query {\n  products: [String!]!\n}\n";

      await integrationDatabase.database.sql.begin(async (sql) => {
        await sql.unsafe(`
          INSERT INTO graphs (id, slug, current_revision, created_at, updated_at)
          VALUES ('${graphId}', 'catalog', 1, '${now}', '${now}')
        `);
        await sql.unsafe(`
          INSERT INTO graph_revisions (graph_id, revision, created_at)
          VALUES ('${graphId}', 1, '${now}')
        `);
      });

      await integrationDatabase.database.sql.begin(async (sql) => {
        await sql.unsafe(`
          INSERT INTO subgraphs (id, graph_id, slug, current_revision, current_schema_revision, created_at, updated_at)
          VALUES ('${subgraphId}', '${graphId}', 'inventory', 1, 1, '${now}', '${now}')
        `);
        await sql.unsafe(`
          INSERT INTO subgraph_revisions (subgraph_id, revision, routing_url, created_at)
          VALUES ('${subgraphId}', 1, 'https://inventory.example.com/graphql', '${now}')
        `);
        await sql.unsafe(`
          INSERT INTO subgraph_schema_revisions (subgraph_id, revision, normalized_sdl, normalized_hash, created_at)
          VALUES ('${subgraphId}', 1, '${normalizedSdl}', '${hashNormalizedSchemaSdl(normalizedSdl)}', '${now}')
        `);
      });

      await assert.rejects(
        integrationDatabase.database.sql`
          UPDATE subgraphs
          SET current_schema_revision = 2
          WHERE id = ${subgraphId}
        `,
        /fk_sg__cur_sch_rev__sgsr/,
      );
    } finally {
      await integrationDatabase.close();
    }
  });

  await t.test(
    "supergraph membership constraints reject subgraph rows from a different graph",
    async () => {
      const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);

      try {
        const graphAId = randomUUID();
        const graphBId = randomUUID();
        const subgraphAId = randomUUID();
        const now = new Date().toISOString();
        const normalizedSdl = "type Query {\n  inventory: String\n}\n";
        const supergraphSdl = "schema { query: Query }\n\ntype Query {\n  product: String\n}\n";

        await integrationDatabase.database.sql.begin(async (sql) => {
          await sql.unsafe(`
            INSERT INTO graphs (id, slug, current_revision, current_supergraph_schema_revision, created_at, updated_at)
            VALUES ('${graphAId}', 'graph-a', 1, NULL, '${now}', '${now}')
          `);
          await sql.unsafe(`
            INSERT INTO graph_revisions (graph_id, revision, created_at)
            VALUES ('${graphAId}', 1, '${now}')
          `);

          await sql.unsafe(`
            INSERT INTO graphs (id, slug, current_revision, current_supergraph_schema_revision, created_at, updated_at)
            VALUES ('${graphBId}', 'graph-b', 1, NULL, '${now}', '${now}')
          `);
          await sql.unsafe(`
            INSERT INTO graph_revisions (graph_id, revision, created_at)
            VALUES ('${graphBId}', 1, '${now}')
          `);

          await sql.unsafe(`
            INSERT INTO subgraphs (id, graph_id, slug, current_revision, current_schema_revision, created_at, updated_at)
            VALUES ('${subgraphAId}', '${graphAId}', 'inventory', 1, 1, '${now}', '${now}')
          `);
          await sql.unsafe(`
            INSERT INTO subgraph_revisions (subgraph_id, revision, routing_url, created_at)
            VALUES ('${subgraphAId}', 1, 'https://inventory.example.com/graphql', '${now}')
          `);
          await sql.unsafe(`
            INSERT INTO subgraph_schema_revisions (subgraph_id, revision, normalized_sdl, normalized_hash, created_at)
            VALUES ('${subgraphAId}', 1, '${normalizedSdl}', '${hashNormalizedSchemaSdl(normalizedSdl)}', '${now}')
          `);

          await sql.unsafe(`
            INSERT INTO supergraph_schema_revisions (graph_id, revision, supergraph_sdl, schema_hash, created_at)
            VALUES ('${graphBId}', 1, '${supergraphSdl}', '${createHash("sha256").update(supergraphSdl).digest("hex")}', '${now}')
          `);
        });

        await assert.rejects(
          integrationDatabase.database.sql`
            INSERT INTO supergraph_schema_revision_subgraphs (
              graph_id,
              supergraph_schema_revision,
              subgraph_id,
              subgraph_revision,
              subgraph_schema_revision
            )
            VALUES (${graphBId}, 1, ${subgraphAId}, 1, 1)
          `,
          /fk_ssrs__sg_graph__sg/,
        );
      } finally {
        await integrationDatabase.close();
      }
    },
  );
});
