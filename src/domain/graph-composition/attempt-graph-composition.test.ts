import assert from "node:assert/strict";
import test from "node:test";

import { attemptGraphComposition } from "./attempt-graph-composition.ts";
import type { GraphCompositionStore } from "./graph-composition-store.ts";
import type { SupergraphComposer } from "./supergraph-composer.ts";
import type {
  GraphCompositionCandidate,
  GraphCompositionMemberReference,
  GraphCompositionTransaction,
  GraphForComposition,
  StoredCompositionAttempt,
} from "./types.ts";

// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
const transaction = {} as GraphCompositionTransaction;

function createGraph(overrides: Partial<GraphForComposition> = {}): GraphForComposition {
  return {
    id: "graph-1",
    currentCompositionRevision: null,
    currentSupergraphSchemaRevision: null,
    ...overrides,
  };
}

function createCompositionCandidate(
  overrides: Partial<GraphCompositionCandidate> = {},
): GraphCompositionCandidate {
  return {
    subgraphId: "subgraph-1",
    slug: "inventory",
    subgraphRevision: 3n,
    routingUrl: "https://inventory.example.com/graphql",
    subgraphSchemaRevision: 4n,
    normalizedSdl: "type Query { products: [String!]! }",
    ...overrides,
  };
}

function toCompositionMembers(
  candidates: ReadonlyArray<GraphCompositionCandidate>,
): ReadonlyArray<GraphCompositionMemberReference> {
  return candidates.map((candidate) => ({
    subgraphId: candidate.subgraphId,
    subgraphRevision: candidate.subgraphRevision,
    subgraphSchemaRevision: candidate.subgraphSchemaRevision,
  }));
}

function createStoredCompositionAttempt(
  overrides: Partial<StoredCompositionAttempt> = {},
): StoredCompositionAttempt {
  return {
    graphId: "graph-1",
    revision: 1n,
    createdAt: new Date("2026-04-19T00:00:00.000Z"),
    ...overrides,
  };
}

await test("attemptGraphComposition()", async (t) => {
  await t.test("clears pointers when no candidates remain and graph has pointers", async () => {
    let clearCurrentCompositionPointersCalls = 0;
    let insertGraphCompositionAttemptCalls = 0;
    const graphCompositionStore: GraphCompositionStore = {
      async clearCurrentCompositionPointers() {
        clearCurrentCompositionPointersCalls += 1;
      },
      async insertGraphCompositionAttempt() {
        insertGraphCompositionAttemptCalls += 1;
        return createStoredCompositionAttempt();
      },
      async publishSupergraphSchema() {
        throw new Error("publishSupergraphSchema should not be called");
      },
      async selectCompositionCandidates() {
        return [];
      },
      async selectCompositionMembers() {
        throw new Error("selectCompositionMembers should not be called");
      },
      async selectLatestCompositionRevision() {
        throw new Error("selectLatestCompositionRevision should not be called");
      },
    };
    const supergraphComposer: SupergraphComposer = {
      composeCompositionCandidates() {
        throw new Error("composeCompositionCandidates should not be called");
      },
    };

    await attemptGraphComposition(
      transaction,
      createGraph({
        currentCompositionRevision: 4n,
      }),
      new Date("2026-04-19T00:00:00.000Z"),
      { graphCompositionStore, supergraphComposer },
    );

    assert.equal(clearCurrentCompositionPointersCalls, 1);
    assert.equal(insertGraphCompositionAttemptCalls, 0);
  });

  await t.test(
    "returns without clearing pointers when no candidates remain and graph has no pointers",
    async () => {
      let clearCurrentCompositionPointersCalls = 0;
      const graphCompositionStore: GraphCompositionStore = {
        async clearCurrentCompositionPointers() {
          clearCurrentCompositionPointersCalls += 1;
        },
        async insertGraphCompositionAttempt() {
          throw new Error("insertGraphCompositionAttempt should not be called");
        },
        async publishSupergraphSchema() {
          throw new Error("publishSupergraphSchema should not be called");
        },
        async selectCompositionCandidates() {
          return [];
        },
        async selectCompositionMembers() {
          throw new Error("selectCompositionMembers should not be called");
        },
        async selectLatestCompositionRevision() {
          throw new Error("selectLatestCompositionRevision should not be called");
        },
      };
      const supergraphComposer: SupergraphComposer = {
        composeCompositionCandidates() {
          throw new Error("composeCompositionCandidates should not be called");
        },
      };

      await attemptGraphComposition(
        transaction,
        createGraph(),
        new Date("2026-04-19T00:00:00.000Z"),
        { graphCompositionStore, supergraphComposer },
      );

      assert.equal(clearCurrentCompositionPointersCalls, 0);
    },
  );

  await t.test("returns early when current composition members match candidates", async () => {
    const candidates = [createCompositionCandidate()];
    let composeCompositionCandidatesCalls = 0;
    let insertGraphCompositionAttemptCalls = 0;
    const graphCompositionStore: GraphCompositionStore = {
      async clearCurrentCompositionPointers() {
        throw new Error("clearCurrentCompositionPointers should not be called");
      },
      async insertGraphCompositionAttempt() {
        insertGraphCompositionAttemptCalls += 1;
        return createStoredCompositionAttempt();
      },
      async publishSupergraphSchema() {
        throw new Error("publishSupergraphSchema should not be called");
      },
      async selectCompositionCandidates() {
        return candidates;
      },
      async selectCompositionMembers() {
        return toCompositionMembers(candidates);
      },
      async selectLatestCompositionRevision() {
        throw new Error("selectLatestCompositionRevision should not be called");
      },
    };
    const supergraphComposer: SupergraphComposer = {
      composeCompositionCandidates() {
        composeCompositionCandidatesCalls += 1;
        return { supergraphSdl: "type Query { _service: String }" };
      },
    };

    await attemptGraphComposition(
      transaction,
      createGraph({
        currentCompositionRevision: 6n,
      }),
      new Date("2026-04-19T00:00:00.000Z"),
      { graphCompositionStore, supergraphComposer },
    );

    assert.equal(composeCompositionCandidatesCalls, 0);
    assert.equal(insertGraphCompositionAttemptCalls, 0);
  });

  await t.test(
    "records composition attempt but does not publish when composition fails",
    async () => {
      const candidates = [createCompositionCandidate()];
      let nextCompositionRevision: bigint | undefined;
      let insertGraphCompositionAttemptCalls = 0;
      let publishSupergraphSchemaCalls = 0;
      const graphCompositionStore: GraphCompositionStore = {
        async clearCurrentCompositionPointers() {
          throw new Error("clearCurrentCompositionPointers should not be called");
        },
        async insertGraphCompositionAttempt(_, params) {
          insertGraphCompositionAttemptCalls += 1;
          nextCompositionRevision = params.nextCompositionRevision;
          return createStoredCompositionAttempt({ revision: 5n });
        },
        async publishSupergraphSchema() {
          publishSupergraphSchemaCalls += 1;
        },
        async selectCompositionCandidates() {
          return candidates;
        },
        async selectCompositionMembers() {
          throw new Error("selectCompositionMembers should not be called");
        },
        async selectLatestCompositionRevision() {
          return 4n;
        },
      };
      const supergraphComposer: SupergraphComposer = {
        composeCompositionCandidates() {
          return { errors: [new Error("composition failed")] };
        },
      };

      await attemptGraphComposition(
        transaction,
        createGraph(),
        new Date("2026-04-19T00:00:00.000Z"),
        { graphCompositionStore, supergraphComposer },
      );

      assert.equal(insertGraphCompositionAttemptCalls, 1);
      assert.equal(nextCompositionRevision, 5n);
      assert.equal(publishSupergraphSchemaCalls, 0);
    },
  );

  await t.test("publishes supergraph SDL on successful composition", async () => {
    const candidates = [createCompositionCandidate()];
    let nextCompositionRevision: bigint | undefined;
    let publishedParams:
      | {
          compositionRevision: bigint;
          createdAt: Date;
          graphId: string;
          supergraphSdl: string;
        }
      | undefined;
    const createdAt = new Date("2026-04-19T00:00:00.000Z");
    const graphCompositionStore: GraphCompositionStore = {
      async clearCurrentCompositionPointers() {
        throw new Error("clearCurrentCompositionPointers should not be called");
      },
      async insertGraphCompositionAttempt(_, params) {
        nextCompositionRevision = params.nextCompositionRevision;
        return createStoredCompositionAttempt({
          createdAt: params.createdAt,
          graphId: params.graphId,
          revision: 1n,
        });
      },
      async publishSupergraphSchema(_, params) {
        publishedParams = params;
      },
      async selectCompositionCandidates() {
        return candidates;
      },
      async selectCompositionMembers() {
        throw new Error("selectCompositionMembers should not be called");
      },
      async selectLatestCompositionRevision() {
        return null;
      },
    };
    const supergraphComposer: SupergraphComposer = {
      composeCompositionCandidates() {
        return { supergraphSdl: "schema { query: Query } type Query { _service: String }" };
      },
    };

    await attemptGraphComposition(transaction, createGraph(), createdAt, {
      graphCompositionStore,
      supergraphComposer,
    });

    assert.equal(nextCompositionRevision, 1n);
    assert.deepEqual(publishedParams, {
      compositionRevision: 1n,
      createdAt,
      graphId: "graph-1",
      supergraphSdl: "schema { query: Query } type Query { _service: String }",
    });
  });
});
