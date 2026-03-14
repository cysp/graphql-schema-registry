// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import test from "node:test";

import { connectIntegrationDatabase } from "../../test-support/database.ts";
import { createGraphWithInitialRevisionInTransaction } from "./create-graph-with-initial-revision.ts";
import { createSubgraphWithInitialRevisionInTransaction } from "./create-subgraph-with-initial-revision.ts";
import { getActiveSubgraphByGraphIdAndSlug } from "./get-active-subgraph-by-graph-id-and-slug.ts";
import { listActiveSubgraphsByGraphId } from "./list-active-subgraphs-by-graph-id.ts";
import { softDeleteSubgraphInTransaction } from "./soft-delete-subgraph.ts";
import { updateSubgraphWithOptimisticLockInTransaction } from "./update-subgraph-with-optimistic-lock.ts";

await test("subgraph persistence integration with postgres", async (t) => {
  const integrationDatabaseUrlFromEnv = process.env["INTEGRATION_TEST_DATABASE_URL"]?.trim();
  if (integrationDatabaseUrlFromEnv === undefined || integrationDatabaseUrlFromEnv === "") {
    t.skip("INTEGRATION_TEST_DATABASE_URL is not configured");
    return;
  }
  const integrationDatabaseUrl = integrationDatabaseUrlFromEnv;

  await t.test("creates, reads, and lists active subgraphs", async () => {
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
      assert.strictEqual(createdSubgraph.revisionId, 1);
      assert.strictEqual(createdSubgraph.graphId, createdGraph.id);
      assert.strictEqual(createdSubgraph.slug, "inventory");
      assert.strictEqual(createdSubgraph.routingUrl, "https://inventory-v1.example.com/graphql");

      const loadedSubgraph = await getActiveSubgraphByGraphIdAndSlug(
        database,
        createdGraph.id,
        "inventory",
      );
      assert.ok(loadedSubgraph);
      assert.strictEqual(loadedSubgraph.id, createdSubgraph.id);
      assert.strictEqual(loadedSubgraph.revisionId, 1);
      assert.strictEqual(loadedSubgraph.routingUrl, "https://inventory-v1.example.com/graphql");

      const listedSubgraphs = await listActiveSubgraphsByGraphId(database, createdGraph.id);
      assert.strictEqual(listedSubgraphs.length, 1);
      assert.ok(listedSubgraphs[0]);
      assert.strictEqual(listedSubgraphs[0].id, createdSubgraph.id);
      assert.strictEqual(listedSubgraphs[0].revisionId, 1);
    } finally {
      await integrationDatabase.close();
    }
  });

  await t.test("returns undefined for duplicate active graph/slug creates", async () => {
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

      const firstCreate = await database.transaction(async (transaction) => {
        return createSubgraphWithInitialRevisionInTransaction(transaction, {
          graphId: createdGraph.id,
          now,
          routingUrl: "https://inventory-v1.example.com/graphql",
          slug: "inventory",
        });
      });
      assert.ok(firstCreate);

      const secondCreate = await database.transaction(async (transaction) => {
        return createSubgraphWithInitialRevisionInTransaction(transaction, {
          graphId: createdGraph.id,
          now,
          routingUrl: "https://inventory-duplicate.example.com/graphql",
          slug: "inventory",
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

      const createdSubgraph = await database.transaction(async (transaction) => {
        return createSubgraphWithInitialRevisionInTransaction(transaction, {
          graphId: createdGraph.id,
          now,
          routingUrl: "https://inventory-v1.example.com/graphql",
          slug: "inventory",
        });
      });
      assert.ok(createdSubgraph);

      const updatedSubgraph = await database.transaction(async (transaction) => {
        return updateSubgraphWithOptimisticLockInTransaction(transaction, {
          currentRevisionId: 1,
          now: new Date("2026-03-01T00:01:00.000Z"),
          routingUrl: "https://inventory-v2.example.com/graphql",
          subgraphId: createdSubgraph.id,
        });
      });

      assert.ok(updatedSubgraph);
      assert.strictEqual(updatedSubgraph.revisionId, 2);
      assert.strictEqual(updatedSubgraph.routingUrl, "https://inventory-v2.example.com/graphql");

      const staleUpdate = await database.transaction(async (transaction) => {
        return updateSubgraphWithOptimisticLockInTransaction(transaction, {
          currentRevisionId: 1,
          now: new Date("2026-03-01T00:02:00.000Z"),
          routingUrl: "https://inventory-stale.example.com/graphql",
          subgraphId: createdSubgraph.id,
        });
      });

      assert.strictEqual(staleUpdate, undefined);

      const loadedSubgraph = await getActiveSubgraphByGraphIdAndSlug(
        database,
        createdGraph.id,
        "inventory",
      );
      assert.ok(loadedSubgraph);
      assert.strictEqual(loadedSubgraph.revisionId, 2);
      assert.strictEqual(loadedSubgraph.routingUrl, "https://inventory-v2.example.com/graphql");
    } finally {
      await integrationDatabase.close();
    }
  });

  await t.test("soft-deletes subgraphs and hides them from reads", async () => {
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

      const firstDelete = await database.transaction(async (transaction) => {
        return softDeleteSubgraphInTransaction(transaction, {
          now: new Date("2026-03-01T00:01:00.000Z"),
          subgraphId: createdSubgraph.id,
        });
      });
      assert.strictEqual(firstDelete, true);

      const secondDelete = await database.transaction(async (transaction) => {
        return softDeleteSubgraphInTransaction(transaction, {
          now: new Date("2026-03-01T00:02:00.000Z"),
          subgraphId: createdSubgraph.id,
        });
      });
      assert.strictEqual(secondDelete, false);

      const loadedSubgraph = await getActiveSubgraphByGraphIdAndSlug(
        database,
        createdGraph.id,
        "inventory",
      );
      assert.strictEqual(loadedSubgraph, undefined);

      const listedSubgraphs = await listActiveSubgraphsByGraphId(database, createdGraph.id);
      assert.deepStrictEqual(listedSubgraphs, []);
    } finally {
      await integrationDatabase.close();
    }
  });
});
