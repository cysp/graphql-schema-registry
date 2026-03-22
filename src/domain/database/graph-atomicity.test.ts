// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import test from "node:test";

import { graphRevisions, graphs, subgraphs } from "../../drizzle/schema.ts";
import { queryCount, connectIntegrationDatabase } from "../../test-support/database.ts";
import { createFailingDatabase } from "../../test-support/failing-database.ts";
import { parseIfMatchHeader } from "../etag.ts";
import { selectActiveGraphBySlug } from "./graph-records.ts";
import { createGraph, deleteGraphBySlug, updateGraphBySlug } from "./graphs.ts";
import { createSubgraph } from "./subgraphs.ts";

function requireDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new assert.AssertionError({
      actual: value,
      expected: "defined value",
      message,
      operator: "!==",
    });
  }

  return value;
}

await test("graph write atomicity", async (t) => {
  const integrationDatabaseUrl = process.env["INTEGRATION_TEST_DATABASE_URL"]?.trim();
  if (!integrationDatabaseUrl) {
    t.skip("INTEGRATION_TEST_DATABASE_URL is not configured");
    return;
  }

  await t.test("rolls back graph creation when revision creation fails", async () => {
    const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);

    try {
      const failingDatabase = createFailingDatabase(integrationDatabase.database.database, {
        error: new Error("forced graph revision insert failure"),
        kind: "insert",
        table: graphRevisions,
      });

      await assert.rejects(
        createGraph(failingDatabase, {
          federationVersion: "2.9",
          now: new Date(),
          slug: "catalog",
        }),
        /forced graph revision insert failure/,
      );

      assert.equal(
        await queryCount(
          integrationDatabase.database.sql,
          "SELECT count(*)::int AS count FROM graphs",
        ),
        0,
      );
      assert.equal(
        await queryCount(
          integrationDatabase.database.sql,
          "SELECT count(*)::int AS count FROM graph_revisions",
        ),
        0,
      );
    } finally {
      await integrationDatabase.close();
    }
  });

  await t.test("rolls back graph updates when advancing the revision fails", async () => {
    const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);

    try {
      const createdGraph = await createGraph(integrationDatabase.database.database, {
        federationVersion: "2.9",
        now: new Date(),
        slug: "catalog",
      });
      assert.equal(createdGraph.kind, "created");

      const failingDatabase = createFailingDatabase(integrationDatabase.database.database, {
        error: new Error("forced graph pointer update failure"),
        kind: "update",
        table: graphs,
      });

      await assert.rejects(
        updateGraphBySlug(failingDatabase, {
          federationVersion: "2.10",
          ifMatch: undefined,
          now: new Date(),
          slug: "catalog",
        }),
        /forced graph pointer update failure/,
      );

      const graph = requireDefined(
        await selectActiveGraphBySlug(integrationDatabase.database.database, "catalog"),
        "Expected graph to still exist after failed update.",
      );
      assert.equal(graph.federationVersion, "2.9");
      assert.equal(graph.revision, 1);

      assert.equal(
        await queryCount(
          integrationDatabase.database.sql,
          `SELECT count(*)::int AS count FROM graph_revisions WHERE graph_id = '${graph.id}'`,
        ),
        1,
      );
    } finally {
      await integrationDatabase.close();
    }
  });

  await t.test("does not mutate graphs on stale preconditions", async () => {
    const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);

    try {
      const createdGraph = await createGraph(integrationDatabase.database.database, {
        federationVersion: "2.9",
        now: new Date(),
        slug: "catalog",
      });
      assert.equal(createdGraph.kind, "created");

      const staleIfMatch = parseIfMatchHeader('"0"');

      const updateResult = await updateGraphBySlug(integrationDatabase.database.database, {
        federationVersion: "2.10",
        ifMatch: staleIfMatch,
        now: new Date(),
        slug: "catalog",
      });
      assert.deepEqual(updateResult, {
        kind: "precondition_failed",
      });

      const deleteResult = await deleteGraphBySlug(integrationDatabase.database.database, {
        ifMatch: staleIfMatch,
        now: new Date(),
        slug: "catalog",
      });
      assert.deepEqual(deleteResult, {
        kind: "precondition_failed",
      });

      const graph = requireDefined(
        await selectActiveGraphBySlug(integrationDatabase.database.database, "catalog"),
        "Expected graph to still exist after stale preconditions.",
      );
      assert.equal(graph.federationVersion, "2.9");
      assert.equal(graph.revision, 1);

      assert.equal(
        await queryCount(
          integrationDatabase.database.sql,
          `SELECT count(*)::int AS count FROM graph_revisions WHERE graph_id = '${graph.id}'`,
        ),
        1,
      );
    } finally {
      await integrationDatabase.close();
    }
  });

  await t.test("rolls back graph deletes when subgraph deletion fails", async () => {
    const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);

    try {
      const createdGraph = await createGraph(integrationDatabase.database.database, {
        federationVersion: "2.9",
        now: new Date(),
        slug: "catalog",
      });
      assert.equal(createdGraph.kind, "created");

      const createdSubgraph = await createSubgraph(integrationDatabase.database.database, {
        graphSlug: "catalog",
        now: new Date(),
        routingUrl: "https://inventory.example.com/graphql",
        slug: "inventory",
      });
      assert.equal(createdSubgraph.kind, "created");

      const failingDatabase = createFailingDatabase(integrationDatabase.database.database, {
        error: new Error("forced subgraph delete failure"),
        kind: "update",
        table: subgraphs,
      });

      await assert.rejects(
        deleteGraphBySlug(failingDatabase, {
          ifMatch: undefined,
          now: new Date(),
          slug: "catalog",
        }),
        /forced subgraph delete failure/,
      );

      const graph = requireDefined(
        await selectActiveGraphBySlug(integrationDatabase.database.database, "catalog"),
        "Expected graph to still exist after failed delete.",
      );
      assert.equal(graph.revision, 1);

      assert.equal(
        await queryCount(
          integrationDatabase.database.sql,
          "SELECT count(*)::int AS count FROM graphs WHERE slug = 'catalog' AND deleted_at IS NULL",
        ),
        1,
      );
      assert.equal(
        await queryCount(
          integrationDatabase.database.sql,
          "SELECT count(*)::int AS count FROM subgraphs WHERE slug = 'inventory' AND deleted_at IS NULL",
        ),
        1,
      );
    } finally {
      await integrationDatabase.close();
    }
  });
});
