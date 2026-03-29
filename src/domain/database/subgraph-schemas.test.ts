// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import test from "node:test";

import { queryCount, connectIntegrationDatabase } from "../../test-support/database.ts";
import { attemptGraphComposition } from "../composition/attempt-graph-composition.ts";
import { selectCurrentGraphCompositionByGraphId } from "./graph-compositions.ts";
import { insertGraphWithInitialRevision, selectActiveGraphBySlug } from "./graphs/repository.ts";
import { publishSubgraphSchemaInTransaction } from "./subgraph-schemas.ts";
import {
  insertSubgraphWithInitialRevision,
  softDeleteSubgraphById,
} from "./subgraphs/repository.ts";

const validSchema = [
  'extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])',
  "",
  'type Product @key(fields: "id") {',
  "  id: ID!",
  "}",
  "",
  "type Query {",
  "  product(id: ID!): Product",
  "}",
].join("\n");

await test("publish subgraph schema", async (t) => {
  const integrationDatabaseUrl = process.env["INTEGRATION_TEST_DATABASE_URL"]?.trim();
  if (!integrationDatabaseUrl) {
    t.skip("INTEGRATION_TEST_DATABASE_URL is not configured");
    return;
  }

  await t.test("returns invalid_schema without creating revisions", async () => {
    const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);

    try {
      const createGraphResult = await integrationDatabase.database.database.transaction(
        async (transaction) =>
          insertGraphWithInitialRevision(transaction, "catalog", "v2.9", new Date()),
      );

      const createSubgraphResult = await integrationDatabase.database.database.transaction(
        async (transaction) =>
          insertSubgraphWithInitialRevision(
            transaction,
            createGraphResult.id,
            "products",
            "https://products.example.com/graphql",
            new Date(),
          ),
      );

      const result = await integrationDatabase.database.database.transaction(async (transaction) =>
        publishSubgraphSchemaInTransaction(transaction, {
          graph: createGraphResult,
          now: new Date(),
          rawSdl: "type Query {",
          subgraph: createSubgraphResult,
        }),
      );

      assert.deepEqual(result, {
        kind: "invalid_schema",
      });
      assert.equal(
        await queryCount(
          integrationDatabase.database.sql,
          "SELECT count(*)::int AS count FROM subgraph_schema_revisions",
        ),
        0,
      );
      assert.equal(
        await queryCount(
          integrationDatabase.database.sql,
          "SELECT count(*)::int AS count FROM graph_compositions",
        ),
        0,
      );
    } finally {
      await integrationDatabase.close();
    }
  });

  await t.test(
    "returns noop for the current schema and leaves the composition unchanged",
    async () => {
      const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);

      try {
        const createGraphResult = await integrationDatabase.database.database.transaction(
          async (transaction) =>
            insertGraphWithInitialRevision(transaction, "catalog", "v2.9", new Date()),
        );

        const createSubgraphResult = await integrationDatabase.database.database.transaction(
          async (transaction) =>
            insertSubgraphWithInitialRevision(
              transaction,
              createGraphResult.id,
              "products",
              "https://products.example.com/graphql",
              new Date(),
            ),
        );

        const firstPublish = await integrationDatabase.database.database.transaction(
          async (transaction) =>
            publishSubgraphSchemaInTransaction(transaction, {
              graph: createGraphResult,
              now: new Date(),
              rawSdl: validSchema,
              subgraph: createSubgraphResult,
            }),
        );
        assert.equal(firstPublish.kind, "published");
        const graphBeforeNoop = await selectActiveGraphBySlug(
          integrationDatabase.database.database,
          "catalog",
        );
        assert.ok(graphBeforeNoop);
        assert.equal(graphBeforeNoop.currentCompositionRevision, 1);

        const compositionBeforeNoop = await selectCurrentGraphCompositionByGraphId(
          integrationDatabase.database.database,
          createGraphResult.id,
          graphBeforeNoop.currentCompositionRevision,
        );
        assert.ok(compositionBeforeNoop);

        const result = await integrationDatabase.database.database.transaction(
          async (transaction) =>
            publishSubgraphSchemaInTransaction(transaction, {
              graph: createGraphResult,
              now: new Date(),
              rawSdl: validSchema,
              subgraph: createSubgraphResult,
            }),
        );

        assert.deepEqual(result, {
          kind: "noop",
          revision: firstPublish.revision,
        });
        assert.equal(
          await queryCount(
            integrationDatabase.database.sql,
            "SELECT count(*)::int AS count FROM subgraph_schema_revisions",
          ),
          1,
        );
        assert.equal(
          await queryCount(
            integrationDatabase.database.sql,
            "SELECT count(*)::int AS count FROM graph_compositions",
          ),
          1,
        );

        const compositionAfterNoop = await selectCurrentGraphCompositionByGraphId(
          integrationDatabase.database.database,
          createGraphResult.id,
          graphBeforeNoop.currentCompositionRevision,
        );
        assert.deepEqual(compositionAfterNoop, compositionBeforeNoop);
      } finally {
        await integrationDatabase.close();
      }
    },
  );

  await t.test(
    "publishes a schema revision and composes the graph when every subgraph has SDL",
    async () => {
      const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);

      try {
        const createGraphResult = await integrationDatabase.database.database.transaction(
          async (transaction) =>
            insertGraphWithInitialRevision(transaction, "catalog", "v2.9", new Date()),
        );

        const createSubgraphResult = await integrationDatabase.database.database.transaction(
          async (transaction) =>
            insertSubgraphWithInitialRevision(
              transaction,
              createGraphResult.id,
              "products",
              "https://products.example.com/graphql",
              new Date(),
            ),
        );

        const result = await integrationDatabase.database.database.transaction(
          async (transaction) =>
            publishSubgraphSchemaInTransaction(transaction, {
              graph: createGraphResult,
              now: new Date(),
              rawSdl: validSchema,
              subgraph: createSubgraphResult,
            }),
        );

        assert.equal(result.kind, "published");
        assert.equal(result.revision, 1);
        assert.equal(
          await queryCount(
            integrationDatabase.database.sql,
            "SELECT count(*)::int AS count FROM subgraph_schema_revisions",
          ),
          1,
        );
        assert.equal(
          await queryCount(
            integrationDatabase.database.sql,
            "SELECT count(*)::int AS count FROM graph_compositions",
          ),
          1,
        );
        assert.equal(
          await queryCount(
            integrationDatabase.database.sql,
            "SELECT count(*)::int AS count FROM graph_composition_subgraphs",
          ),
          1,
        );
        const graph = await selectActiveGraphBySlug(
          integrationDatabase.database.database,
          "catalog",
        );
        assert.ok(graph);
        assert.equal(graph.currentCompositionRevision, 1);

        const composition = await selectCurrentGraphCompositionByGraphId(
          integrationDatabase.database.database,
          createGraphResult.id,
          graph.currentCompositionRevision,
        );
        assert.ok(composition);
        assert.equal(composition.graphRevision, 1);
        assert.equal(composition.revision, 1);
        assert.match(composition.supergraphSdl, /schema\s+@link/);
        assert.match(composition.supergraphSdl, /type Product\s+@join__type/);
      } finally {
        await integrationDatabase.close();
      }
    },
  );

  await t.test(
    "allocates a new composition revision after the current composition is cleared",
    async () => {
      const integrationDatabase = await connectIntegrationDatabase(integrationDatabaseUrl);

      try {
        const now = new Date();
        const createdGraph = await integrationDatabase.database.database.transaction(
          async (transaction) =>
            insertGraphWithInitialRevision(transaction, "catalog", "v2.9", now),
        );

        const firstSubgraph = await integrationDatabase.database.database.transaction(
          async (transaction) =>
            insertSubgraphWithInitialRevision(
              transaction,
              createdGraph.id,
              "products",
              "https://products.example.com/graphql",
              now,
            ),
        );

        const firstPublish = await integrationDatabase.database.database.transaction(
          async (transaction) =>
            publishSubgraphSchemaInTransaction(transaction, {
              graph: createdGraph,
              now: new Date(),
              rawSdl: validSchema,
              subgraph: firstSubgraph,
            }),
        );
        assert.equal(firstPublish.kind, "published");
        assert.equal(firstPublish.revision, 1);
        const graphBeforeClear = await selectActiveGraphBySlug(
          integrationDatabase.database.database,
          "catalog",
        );
        assert.ok(graphBeforeClear);
        const compositionRevisionBeforeClear = graphBeforeClear.currentCompositionRevision;
        if (compositionRevisionBeforeClear === null) {
          throw new Error("Expected a current composition revision before clearing.");
        }
        const compositionCountBeforeClear = await queryCount(
          integrationDatabase.database.sql,
          "SELECT count(*)::int AS count FROM graph_compositions",
        );

        await integrationDatabase.database.database.transaction(async (transaction) => {
          await softDeleteSubgraphById(transaction, firstSubgraph.id, new Date());
          await attemptGraphComposition(transaction, createdGraph.id, new Date());
        });

        const clearedGraph = await selectActiveGraphBySlug(
          integrationDatabase.database.database,
          "catalog",
        );
        assert.ok(clearedGraph);
        assert.equal(clearedGraph.currentCompositionRevision, null);

        const secondSubgraph = await integrationDatabase.database.database.transaction(
          async (transaction) =>
            insertSubgraphWithInitialRevision(
              transaction,
              createdGraph.id,
              "inventory",
              "https://inventory.example.com/graphql",
              new Date(),
            ),
        );

        const secondPublish = await integrationDatabase.database.database.transaction(
          async (transaction) =>
            publishSubgraphSchemaInTransaction(transaction, {
              graph: clearedGraph,
              now: new Date(),
              rawSdl: validSchema
                .replaceAll("Product", "Inventory")
                .replace("products", "inventory"),
              subgraph: secondSubgraph,
            }),
        );

        assert.equal(secondPublish.kind, "published");
        assert.equal(secondPublish.revision, 1);

        const recomposedGraph = await selectActiveGraphBySlug(
          integrationDatabase.database.database,
          "catalog",
        );
        assert.ok(recomposedGraph);
        const recomposedCompositionRevision = recomposedGraph.currentCompositionRevision;
        if (recomposedCompositionRevision === null) {
          throw new Error("Expected a current composition revision after recomposition.");
        }
        assert.ok(recomposedCompositionRevision > compositionRevisionBeforeClear);
        assert.equal(
          await queryCount(
            integrationDatabase.database.sql,
            "SELECT count(*)::int AS count FROM graph_compositions",
          ),
          compositionCountBeforeClear + 1,
        );

        const composition = await selectCurrentGraphCompositionByGraphId(
          integrationDatabase.database.database,
          createdGraph.id,
          recomposedCompositionRevision,
        );
        assert.ok(composition);
        assert.equal(composition.revision, recomposedCompositionRevision);
      } finally {
        await integrationDatabase.close();
      }
    },
  );
});
