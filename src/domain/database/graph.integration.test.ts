// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import test from "node:test";

import { connectIntegrationDatabase } from "../../test-support/database.ts";
import { createGraphWithInitialRevisionInTransaction } from "./create-graph-with-initial-revision.ts";
import { createSubgraphWithInitialRevisionInTransaction } from "./create-subgraph-with-initial-revision.ts";
import { getActiveGraphBySlug } from "./get-active-graph-by-slug.ts";
import { getActiveSubgraphByGraphIdAndSlug } from "./get-active-subgraph-by-graph-id-and-slug.ts";
import { listActiveGraphs } from "./list-active-graphs.ts";
import { listActiveSubgraphsByGraphId } from "./list-active-subgraphs-by-graph-id.ts";
import { softDeleteGraphAndSubgraphsInTransaction } from "./soft-delete-graph-and-subgraphs.ts";
import { updateGraphWithOptimisticLockInTransaction } from "./update-graph-with-optimistic-lock.ts";

await test("graph persistence integration with postgres", async (t) => {
  const integrationDatabaseUrlFromEnv = process.env["INTEGRATION_TEST_DATABASE_URL"]?.trim();
  if (integrationDatabaseUrlFromEnv === undefined || integrationDatabaseUrlFromEnv === "") {
    t.skip("INTEGRATION_TEST_DATABASE_URL is not configured");
    return;
  }
  const integrationDatabaseUrl = integrationDatabaseUrlFromEnv;

  await t.test("creates, reads, and lists active graphs", async () => {
    const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);
    const { database } = integrationDatabase.database;

    try {
      const now = new Date("2026-03-01T00:00:00.000Z");

      const createdGraph = await database.transaction(async (transaction) => {
        return createGraphWithInitialRevisionInTransaction(transaction, {
          federationVersion: "2.9",
          now,
          slug: "catalog",
        });
      });

      assert.ok(createdGraph);
      assert.strictEqual(createdGraph.revisionId, 1);
      assert.strictEqual(createdGraph.slug, "catalog");
      assert.strictEqual(createdGraph.federationVersion, "2.9");

      const loadedGraph = await getActiveGraphBySlug(database, "catalog");
      assert.ok(loadedGraph);
      assert.strictEqual(loadedGraph.id, createdGraph.id);
      assert.strictEqual(loadedGraph.revisionId, 1);
      assert.strictEqual(loadedGraph.federationVersion, "2.9");

      const listedGraphs = await listActiveGraphs(database);
      assert.strictEqual(listedGraphs.length, 1);
      assert.ok(listedGraphs[0]);
      assert.strictEqual(listedGraphs[0].id, createdGraph.id);
      assert.strictEqual(listedGraphs[0].revisionId, 1);
    } finally {
      await integrationDatabase.close();
    }
  });

  await t.test("returns undefined for duplicate active slug creates", async () => {
    const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);
    const { database } = integrationDatabase.database;

    try {
      const now = new Date("2026-03-01T00:00:00.000Z");

      const firstCreate = await database.transaction(async (transaction) => {
        return createGraphWithInitialRevisionInTransaction(transaction, {
          federationVersion: "2.9",
          now,
          slug: "catalog",
        });
      });
      assert.ok(firstCreate);

      const secondCreate = await database.transaction(async (transaction) => {
        return createGraphWithInitialRevisionInTransaction(transaction, {
          federationVersion: "2.10",
          now,
          slug: "catalog",
        });
      });
      assert.strictEqual(secondCreate, undefined);
    } finally {
      await integrationDatabase.close();
    }
  });

  await t.test("updates by optimistic lock and rejects stale revisions", async () => {
    const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);
    const { database } = integrationDatabase.database;

    try {
      const now = new Date("2026-03-01T00:00:00.000Z");

      const createdGraph = await database.transaction(async (transaction) => {
        return createGraphWithInitialRevisionInTransaction(transaction, {
          federationVersion: "2.9",
          now,
          slug: "catalog",
        });
      });
      assert.ok(createdGraph);

      const updatedGraph = await database.transaction(async (transaction) => {
        return updateGraphWithOptimisticLockInTransaction(transaction, {
          currentRevisionId: 1,
          federationVersion: "2.10",
          graphId: createdGraph.id,
          now: new Date("2026-03-01T00:01:00.000Z"),
        });
      });
      assert.ok(updatedGraph);
      assert.strictEqual(updatedGraph.revisionId, 2);
      assert.strictEqual(updatedGraph.federationVersion, "2.10");

      const staleUpdate = await database.transaction(async (transaction) => {
        return updateGraphWithOptimisticLockInTransaction(transaction, {
          currentRevisionId: 1,
          federationVersion: "2.11",
          graphId: createdGraph.id,
          now: new Date("2026-03-01T00:02:00.000Z"),
        });
      });
      assert.strictEqual(staleUpdate, undefined);

      const loadedGraph = await getActiveGraphBySlug(database, "catalog");
      assert.ok(loadedGraph);
      assert.strictEqual(loadedGraph.revisionId, 2);
      assert.strictEqual(loadedGraph.federationVersion, "2.10");
    } finally {
      await integrationDatabase.close();
    }
  });

  await t.test("soft-deletes graphs and hides them from reads and lists", async () => {
    const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);
    const { database } = integrationDatabase.database;

    try {
      const now = new Date("2026-03-01T00:00:00.000Z");

      const createdGraph = await database.transaction(async (transaction) => {
        return createGraphWithInitialRevisionInTransaction(transaction, {
          federationVersion: "2.9",
          now,
          slug: "catalog",
        });
      });
      assert.ok(createdGraph);

      const firstDelete = await database.transaction(async (transaction) => {
        return softDeleteGraphAndSubgraphsInTransaction(transaction, {
          graphId: createdGraph.id,
          now: new Date("2026-03-01T00:01:00.000Z"),
        });
      });
      assert.strictEqual(firstDelete, true);

      const secondDelete = await database.transaction(async (transaction) => {
        return softDeleteGraphAndSubgraphsInTransaction(transaction, {
          graphId: createdGraph.id,
          now: new Date("2026-03-01T00:02:00.000Z"),
        });
      });
      assert.strictEqual(secondDelete, false);

      const loadedGraph = await getActiveGraphBySlug(database, "catalog");
      assert.strictEqual(loadedGraph, undefined);

      const listedGraphs = await listActiveGraphs(database);
      assert.deepStrictEqual(listedGraphs, []);
    } finally {
      await integrationDatabase.close();
    }
  });

  await t.test("soft-delete cascades to active subgraphs", async () => {
    const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);
    const { database } = integrationDatabase.database;

    try {
      const now = new Date("2026-03-01T00:00:00.000Z");

      const createdGraph = await database.transaction(async (transaction) => {
        return createGraphWithInitialRevisionInTransaction(transaction, {
          federationVersion: "2.9",
          now,
          slug: "catalog",
        });
      });
      assert.ok(createdGraph);

      const createdSubgraph = await database.transaction(async (transaction) => {
        return createSubgraphWithInitialRevisionInTransaction(transaction, {
          graphId: createdGraph.id,
          now,
          routingUrl: "https://inventory-v1.example.com/graphql",
          slug: "inventory",
        });
      });
      assert.ok(createdSubgraph);

      const loadedSubgraphBeforeDelete = await getActiveSubgraphByGraphIdAndSlug(
        database,
        createdGraph.id,
        "inventory",
      );
      assert.ok(loadedSubgraphBeforeDelete);

      const deleted = await database.transaction(async (transaction) => {
        return softDeleteGraphAndSubgraphsInTransaction(transaction, {
          graphId: createdGraph.id,
          now: new Date("2026-03-01T00:01:00.000Z"),
        });
      });
      assert.strictEqual(deleted, true);

      const loadedSubgraphAfterDelete = await getActiveSubgraphByGraphIdAndSlug(
        database,
        createdGraph.id,
        "inventory",
      );
      assert.strictEqual(loadedSubgraphAfterDelete, undefined);

      const listedSubgraphsAfterDelete = await listActiveSubgraphsByGraphId(
        database,
        createdGraph.id,
      );
      assert.deepStrictEqual(listedSubgraphsAfterDelete, []);
    } finally {
      await integrationDatabase.close();
    }
  });
});
