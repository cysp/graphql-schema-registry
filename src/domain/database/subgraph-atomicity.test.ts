// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import test from "node:test";

import { subgraphRevisions, subgraphs } from "../../drizzle/schema.ts";
import { queryCount, connectIntegrationDatabase } from "../../test-support/database.ts";
import { createFailingDatabase } from "../../test-support/failing-database.ts";
import { parseIfMatchHeader } from "../etag.ts";
import { createGraph } from "./graphs.ts";
import { selectActiveSubgraphByGraphSlugAndSubgraphSlug } from "./subgraph-records.ts";
import { createSubgraph, deleteSubgraphBySlugs, updateSubgraphBySlugs } from "./subgraphs.ts";

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

await test("subgraph write atomicity", async (t) => {
  const integrationDatabaseUrl = process.env["INTEGRATION_TEST_DATABASE_URL"]?.trim();
  if (!integrationDatabaseUrl) {
    t.skip("INTEGRATION_TEST_DATABASE_URL is not configured");
    return;
  }

  await t.test("rolls back subgraph creation when revision creation fails", async () => {
    const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);

    try {
      const createdGraph = await createGraph(integrationDatabase.database.database, {
        federationVersion: "2.9",
        now: new Date(),
        slug: "catalog",
      });
      assert.equal(createdGraph.kind, "created");

      const failingDatabase = createFailingDatabase(integrationDatabase.database.database, {
        error: new Error("forced subgraph revision insert failure"),
        kind: "insert",
        table: subgraphRevisions,
      });

      await assert.rejects(
        createSubgraph(failingDatabase, {
          graphSlug: "catalog",
          now: new Date(),
          routingUrl: "https://inventory.example.com/graphql",
          slug: "inventory",
        }),
        /forced subgraph revision insert failure/,
      );

      assert.equal(
        await queryCount(
          integrationDatabase.database.sql,
          "SELECT count(*)::int AS count FROM subgraphs",
        ),
        0,
      );
      assert.equal(
        await queryCount(
          integrationDatabase.database.sql,
          "SELECT count(*)::int AS count FROM subgraph_revisions",
        ),
        0,
      );
    } finally {
      await integrationDatabase.close();
    }
  });

  await t.test("rolls back subgraph updates when advancing the revision fails", async () => {
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
        routingUrl: "https://inventory-v1.example.com/graphql",
        slug: "inventory",
      });
      assert.equal(createdSubgraph.kind, "created");

      const failingDatabase = createFailingDatabase(integrationDatabase.database.database, {
        error: new Error("forced subgraph pointer update failure"),
        kind: "update",
        table: subgraphs,
      });

      await assert.rejects(
        updateSubgraphBySlugs(failingDatabase, {
          graphSlug: "catalog",
          ifMatch: undefined,
          now: new Date(),
          routingUrl: "https://inventory-v2.example.com/graphql",
          subgraphSlug: "inventory",
        }),
        /forced subgraph pointer update failure/,
      );

      const subgraph = requireDefined(
        await selectActiveSubgraphByGraphSlugAndSubgraphSlug(
          integrationDatabase.database.database,
          "catalog",
          "inventory",
        ),
        "Expected subgraph to still exist after failed update.",
      );
      assert.equal(subgraph.revision, 1);
      assert.equal(subgraph.routingUrl, "https://inventory-v1.example.com/graphql");

      assert.equal(
        await queryCount(
          integrationDatabase.database.sql,
          `SELECT count(*)::int AS count FROM subgraph_revisions WHERE subgraph_id = '${subgraph.id}'`,
        ),
        1,
      );
    } finally {
      await integrationDatabase.close();
    }
  });

  await t.test("does not mutate subgraphs on stale preconditions", async () => {
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
        routingUrl: "https://inventory-v1.example.com/graphql",
        slug: "inventory",
      });
      assert.equal(createdSubgraph.kind, "created");

      const staleIfMatch = parseIfMatchHeader('"0"');

      const updateResult = await updateSubgraphBySlugs(integrationDatabase.database.database, {
        graphSlug: "catalog",
        ifMatch: staleIfMatch,
        now: new Date(),
        routingUrl: "https://inventory-v2.example.com/graphql",
        subgraphSlug: "inventory",
      });
      assert.deepEqual(updateResult, {
        kind: "precondition_failed",
      });

      const deleteResult = await deleteSubgraphBySlugs(integrationDatabase.database.database, {
        graphSlug: "catalog",
        ifMatch: staleIfMatch,
        now: new Date(),
        subgraphSlug: "inventory",
      });
      assert.deepEqual(deleteResult, {
        kind: "precondition_failed",
      });

      const subgraph = requireDefined(
        await selectActiveSubgraphByGraphSlugAndSubgraphSlug(
          integrationDatabase.database.database,
          "catalog",
          "inventory",
        ),
        "Expected subgraph to still exist after stale preconditions.",
      );
      assert.equal(subgraph.revision, 1);
      assert.equal(subgraph.routingUrl, "https://inventory-v1.example.com/graphql");

      assert.equal(
        await queryCount(
          integrationDatabase.database.sql,
          `SELECT count(*)::int AS count FROM subgraph_revisions WHERE subgraph_id = '${subgraph.id}'`,
        ),
        1,
      );
    } finally {
      await integrationDatabase.close();
    }
  });

  await t.test("rolls back subgraph deletes when the delete update fails", async () => {
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
        routingUrl: "https://inventory-v1.example.com/graphql",
        slug: "inventory",
      });
      assert.equal(createdSubgraph.kind, "created");

      const failingDatabase = createFailingDatabase(integrationDatabase.database.database, {
        error: new Error("forced subgraph delete update failure"),
        kind: "update",
        table: subgraphs,
      });

      await assert.rejects(
        deleteSubgraphBySlugs(failingDatabase, {
          graphSlug: "catalog",
          ifMatch: undefined,
          now: new Date(),
          subgraphSlug: "inventory",
        }),
        /forced subgraph delete update failure/,
      );

      const subgraph = requireDefined(
        await selectActiveSubgraphByGraphSlugAndSubgraphSlug(
          integrationDatabase.database.database,
          "catalog",
          "inventory",
        ),
        "Expected subgraph to still exist after failed delete.",
      );
      assert.equal(subgraph.revision, 1);

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
