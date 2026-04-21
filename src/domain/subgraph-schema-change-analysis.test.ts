import assert from "node:assert/strict";
import test from "node:test";

import { GraphQLError, buildSchema } from "graphql";

import {
  analyzeComposedSchemaChanges,
  createCompositionFailureAnalysis,
  normalizeCompositionErrors,
} from "./subgraph-schema-change-analysis.ts";

await test("subgraph schema change analysis", async (t) => {
  await t.test("reports breaking, dangerous, and safe changes when a baseline exists", () => {
    const baselineSchema = buildSchema(`
      directive @trace(enabled: Boolean) on FIELD_DEFINITION

      type Query {
        product(id: ID!): Product
        status: String
      }

      type Product {
        id: ID!
        name: String!
      }

      enum SortDirection {
        ASC
      }
    `);

    const candidateSchema = buildSchema(`
      directive @trace(enabled: Boolean, sample: Int) on FIELD_DEFINITION

      type Query {
        product(id: ID!): Product
        reviews: [Review!]!
      }

      type Product {
        id: ID!
      }

      type Review {
        id: ID!
        body: String!
      }

      enum SortDirection {
        ASC
        DESC
      }
    `);

    const analysis = analyzeComposedSchemaChanges({
      baselineSchema,
      candidateSchema,
    });

    assert.equal(analysis.composed, true);
    assert.equal(analysis.baselineAvailable, true);
    assert.equal(analysis.summary.breakingChanges, 2);
    assert.equal(analysis.summary.dangerousChanges, 1);
    assert.equal(analysis.summary.safeChanges, 5);
    assert.equal(analysis.summary.totalChanges, 8);

    assert.deepEqual(
      analysis.breakingChanges.map((change) => change.type),
      ["FIELD_REMOVED", "FIELD_REMOVED"],
    );
    assert.deepEqual(
      analysis.dangerousChanges.map((change) => change.type),
      ["VALUE_ADDED_TO_ENUM"],
    );

    assert.ok(
      analysis.changes.some(
        (change) =>
          change.severity === "safe" &&
          change.type === "TYPE_ADDED" &&
          change.message === "Review was added.",
      ),
    );
    assert.ok(
      analysis.changes.some(
        (change) =>
          change.severity === "safe" &&
          change.type === "FIELD_ADDED" &&
          change.message === "Query.reviews was added.",
      ),
    );
    assert.ok(
      analysis.changes.some(
        (change) =>
          change.severity === "safe" &&
          change.type === "DIRECTIVE_ARG_ADDED" &&
          change.message === "sample was added to trace.",
      ),
    );
  });

  await t.test("treats missing baseline as additive-only changes", () => {
    const candidateSchema = buildSchema(`
      directive @trace(enabled: Boolean) on FIELD_DEFINITION

      type Query {
        hello: String
      }

      type Product {
        id: ID!
      }
    `);

    const analysis = analyzeComposedSchemaChanges({
      baselineSchema: undefined,
      candidateSchema,
    });

    assert.equal(analysis.composed, true);
    assert.equal(analysis.baselineAvailable, false);
    assert.equal(analysis.summary.breakingChanges, 0);
    assert.equal(analysis.summary.dangerousChanges, 0);
    assert.equal(analysis.breakingChanges.length, 0);
    assert.equal(analysis.dangerousChanges.length, 0);
    assert.ok(
      analysis.changes.every((change) => change.severity === "safe"),
      "all additive baseline-less changes should be marked safe",
    );
    assert.ok(
      analysis.changes.some(
        (change) => change.type === "TYPE_ADDED" && change.message === "Product was added.",
      ),
    );
    assert.ok(
      analysis.changes.some(
        (change) =>
          change.type === "FIELD_ADDED" && change.message === "Query.hello was added.",
      ),
    );
  });

  await t.test("orders change output deterministically", () => {
    const baselineSchema = buildSchema(`
      type Query {
        b: String
        a: String
      }
    `);
    const candidateSchema = buildSchema(`
      type Query {
        c: String
        b: String
      }

      type Zed {
        id: ID!
      }
    `);

    const first = analyzeComposedSchemaChanges({ baselineSchema, candidateSchema });
    const second = analyzeComposedSchemaChanges({ baselineSchema, candidateSchema });

    assert.deepEqual(first, second);
  });

  await t.test("normalizes composition errors to stable fields", () => {
    const errors = normalizeCompositionErrors([
      new GraphQLError("First", {
        extensions: {
          code: "FST",
        },
      }),
      new GraphQLError("Second", {
        extensions: {
          code: 42,
        },
      }),
    ]);

    assert.deepEqual(errors, [
      { code: "FST", message: "First" },
      { message: "Second" },
    ]);
  });

  await t.test("returns an empty diff envelope for composition failures", () => {
    const analysis = createCompositionFailureAnalysis({
      baselineAvailable: true,
      compositionErrors: [{ message: "boom" }],
    });

    assert.equal(analysis.composed, false);
    assert.equal(analysis.baselineAvailable, true);
    assert.deepEqual(analysis.changes, []);
    assert.deepEqual(analysis.breakingChanges, []);
    assert.deepEqual(analysis.dangerousChanges, []);
    assert.deepEqual(analysis.compositionErrors, [{ message: "boom" }]);
    assert.deepEqual(analysis.summary, {
      totalChanges: 0,
      breakingChanges: 0,
      dangerousChanges: 0,
      safeChanges: 0,
      compositionErrors: 1,
    });
  });
});
