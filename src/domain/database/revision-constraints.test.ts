// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { connectIntegrationDatabase } from "../../test-support/database.ts";

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
          INSERT INTO graphs (id, slug, revision, created_at, updated_at)
          VALUES ('${graphId}', 'catalog', 1, '${now}', '${now}')
        `);
        await sql.unsafe(`
          INSERT INTO graph_revisions (graph_id, revision, federation_version, created_at)
          VALUES ('${graphId}', 1, '2.9', '${now}')
        `);
      });

      await assert.rejects(
        integrationDatabase.database.sql`
          UPDATE graphs
          SET revision = 2
          WHERE id = ${graphId}
        `,
        /graphs_revision_fkey/,
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
          INSERT INTO graphs (id, slug, revision, created_at, updated_at)
          VALUES ('${graphId}', 'catalog', 1, '${now}', '${now}')
        `);
        await sql.unsafe(`
          INSERT INTO graph_revisions (graph_id, revision, federation_version, created_at)
          VALUES ('${graphId}', 1, '2.9', '${now}')
        `);
      });

      await integrationDatabase.database.sql.begin(async (sql) => {
        await sql.unsafe(`
          INSERT INTO subgraphs (id, graph_id, slug, revision, created_at, updated_at)
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
          SET revision = 2
          WHERE id = ${subgraphId}
        `,
        /subgraphs_revision_fkey/,
      );
    } finally {
      await integrationDatabase.close();
    }
  });

  await t.test("graph composition constituent constraints are deferred and enforced", async () => {
    const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);

    try {
      const graphId = randomUUID();
      const subgraphId = randomUUID();
      const now = new Date().toISOString();

      await integrationDatabase.database.sql.begin(async (sql) => {
        await sql.unsafe(`
          INSERT INTO graphs (id, slug, revision, created_at, updated_at)
          VALUES ('${graphId}', 'catalog', 1, '${now}', '${now}')
        `);
        await sql.unsafe(`
          INSERT INTO graph_revisions (graph_id, revision, federation_version, created_at)
          VALUES ('${graphId}', 1, '2.9', '${now}')
        `);
        await sql.unsafe(`
          INSERT INTO subgraphs (id, graph_id, slug, revision, created_at, updated_at)
          VALUES ('${subgraphId}', '${graphId}', 'inventory', 1, '${now}', '${now}')
        `);
        await sql.unsafe(`
          INSERT INTO subgraph_revisions (subgraph_id, revision, routing_url, created_at)
          VALUES ('${subgraphId}', 1, 'https://inventory.example.com/graphql', '${now}')
        `);
        await sql.unsafe(`
          INSERT INTO subgraph_schema_revisions (subgraph_id, revision, normalized_sdl, normalized_hash, created_at)
          VALUES ('${subgraphId}', 1, 'type Query { inventory: String! }', 'hash', '${now}')
        `);
        await sql.unsafe(`
          INSERT INTO graph_compositions (graph_id, revision, graph_revision, supergraph_sdl, created_at)
          VALUES ('${graphId}', 1, 1, 'schema { query: Query } type Query { inventory: String! }', '${now}')
        `);
      });

      await assert.rejects(
        integrationDatabase.database.sql`
          INSERT INTO graph_composition_subgraphs (
            graph_id,
            composition_revision,
            subgraph_id,
            subgraph_revision,
            subgraph_schema_revision
          )
          VALUES (
            ${graphId},
            2,
            ${subgraphId},
            1,
            1
          )
        `,
        /graph_composition_subgraphs_composition_fkey/,
      );
    } finally {
      await integrationDatabase.close();
    }
  });
});
