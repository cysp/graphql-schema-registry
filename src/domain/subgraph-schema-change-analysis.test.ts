import assert from "node:assert/strict";
import test from "node:test";

import { GraphQLError, buildSchema, parse, validate } from "graphql";

import {
  analyzeComposedSchemaChanges,
  createCompositionFailureAnalysis,
  normalizeCompositionErrors,
} from "./subgraph-schema-change-analysis.ts";

await test("subgraph schema change analysis", async (t) => {
  await t.test("reports coordinate-based changes when a baseline exists", () => {
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
    assert.equal(analysis.summary.breakingChanges, 2);
    assert.equal(analysis.summary.dangerousChanges, 1);
    assert.equal(analysis.summary.safeChanges, 5);
    assert.equal(analysis.summary.totalChanges, 8);

    assert.ok(
      analysis.changes.some(
        (change) =>
          change.coordinate === "Product.name" &&
          change.severity === "breaking" &&
          change.type === "FIELD_REMOVED",
      ),
    );
    assert.ok(
      analysis.changes.some(
        (change) =>
          change.coordinate === "Query.status" &&
          change.severity === "breaking" &&
          change.type === "FIELD_REMOVED",
      ),
    );
    assert.ok(
      analysis.changes.some(
        (change) =>
          change.coordinate === "SortDirection.DESC" &&
          change.severity === "dangerous" &&
          change.type === "VALUE_ADDED_TO_ENUM",
      ),
    );
    assert.ok(
      analysis.changes.some(
        (change) =>
          change.coordinate === "Review" &&
          change.severity === "safe" &&
          change.type === "TYPE_ADDED",
      ),
    );
    assert.ok(
      analysis.changes.some(
        (change) =>
          change.coordinate === "Query.reviews" &&
          change.severity === "safe" &&
          change.type === "FIELD_ADDED",
      ),
    );
    assert.ok(
      analysis.changes.some(
        (change) =>
          change.coordinate === "@trace(sample:)" &&
          change.severity === "safe" &&
          change.type === "DIRECTIVE_ARG_ADDED",
      ),
    );
  });

  await t.test("orders change output by coordinate, then severity, then type", () => {
    const baselineSchema = buildSchema(`
      type Query {
        c: String
        b: String
        a: String
      }
    `);
    const candidateSchema = buildSchema(`
      type Query {
        c(arg: String): String
        b: Int
      }
    `);

    const analysis = analyzeComposedSchemaChanges({ baselineSchema, candidateSchema });

    assert.deepEqual(
      analysis.changes.map((change) => `${change.coordinate}|${change.severity}|${change.type}`),
      [
        "Query.a|breaking|FIELD_REMOVED",
        "Query.b|breaking|FIELD_CHANGED_KIND",
        "Query.c(arg:)|dangerous|OPTIONAL_ARG_ADDED",
      ],
    );
  });

  await t.test("treats missing baseline as additive-only changes with coordinates", () => {
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
    assert.equal(analysis.summary.breakingChanges, 0);
    assert.equal(analysis.summary.dangerousChanges, 0);
    assert.ok(
      analysis.changes.every((change) => change.severity === "safe"),
      "all additive baseline-less changes should be marked safe",
    );
    assert.ok(
      analysis.changes.some(
        (change) => change.coordinate === "Product" && change.type === "TYPE_ADDED",
      ),
    );
    assert.ok(
      analysis.changes.some(
        (change) => change.coordinate === "Query.hello" && change.type === "FIELD_ADDED",
      ),
    );
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

    assert.deepEqual(errors, [{ code: "FST", message: "First" }, { message: "Second" }]);
  });

  await t.test("returns an empty diff envelope for composition failures", () => {
    const analysis = createCompositionFailureAnalysis({
      compositionErrors: [{ message: "boom" }],
    });

    assert.equal(analysis.composed, false);
    assert.deepEqual(analysis.changes, []);
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

await test("reports input default changes, including newly required inputs", () => {
  const baselineSchema = buildSchema("type Query { x(i: I): String } input I { a: Int! = 1 }");
  const candidateSchema = buildSchema("type Query { x(i: I): String } input I { a: Int! }");
  assert.equal(validate(baselineSchema, parse("{ x(i: {}) }")).length, 0);
  assert.equal(validate(candidateSchema, parse("{ x(i: {}) }")).length, 1);
  const analysis = analyzeComposedSchemaChanges({ baselineSchema, candidateSchema });
  assert.equal(analysis.summary.breakingChanges, 1);
  assert.deepEqual(
    analysis.changes.map(({ coordinate, severity }) => ({ coordinate, severity })),
    [{ coordinate: "I.a", severity: "breaking" }],
  );
  for (const [before, after] of [
    ["Int = 1", "Int = 2"],
    ["Int", "Int = 1"],
    ["Int = 1", "Int"],
  ]) {
    const changed = analyzeComposedSchemaChanges({
      baselineSchema: buildSchema(`type Query { x(i: I): String } input I { a: ${before} }`),
      candidateSchema: buildSchema(`type Query { x(i: I): String } input I { a: ${after} }`),
    });
    assert.equal(changed.summary.dangerousChanges, 1);
    assert.equal(changed.changes[0]?.coordinate, "I.a");
  }
});

await test("reports argument default removal as breaking when omission becomes invalid", () => {
  const baselineSchema = buildSchema("type Query { x(a: Int! = 1): String }");
  const candidateSchema = buildSchema("type Query { x(a: Int!): String }");
  assert.equal(validate(baselineSchema, parse("{ x }")).length, 0);
  assert.equal(validate(candidateSchema, parse("{ x }")).length, 1);
  const analysis = analyzeComposedSchemaChanges({ baselineSchema, candidateSchema });
  assert.equal(analysis.summary.breakingChanges, 1);
  assert.equal(analysis.summary.dangerousChanges, 0);
  assert.equal(analysis.changes[0]?.severity, "breaking");
});
