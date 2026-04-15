import assert from "node:assert/strict";
import test from "node:test";

import {
  createSupergraphSchemaUpdateBroker,
  type SupergraphSchemaUpdateBroker,
} from "./supergraph-schema-update-broker.ts";
import { encodeSupergraphSchemaUpdatedNotification } from "./supergraph-schema-updates.ts";

function createBrokerHarness(): {
  broker: SupergraphSchemaUpdateBroker;
  emit: (graphId: string, revision: bigint) => void;
  listenCalls: () => number;
  unlistenCalls: () => number;
} {
  let onnotify: ((payload: string) => void) | undefined;
  let listenCallCount = 0;
  let unlistenCallCount = 0;

  const broker = createSupergraphSchemaUpdateBroker(async (_channel, listener) => {
    listenCallCount += 1;
    onnotify = listener;

    return {
      async unlisten() {
        unlistenCallCount += 1;
      },
    };
  });

  return {
    broker,
    emit(graphId, revision) {
      onnotify?.(
        encodeSupergraphSchemaUpdatedNotification({
          compositionRevision: revision,
          graphId,
        }),
      );
    },
    listenCalls: () => listenCallCount,
    unlistenCalls: () => unlistenCallCount,
  };
}

await test("supergraph schema update broker", async (t) => {
  await t.test("starts one listener for the first subscriber and reuses it for more", async () => {
    const { broker, listenCalls, unlistenCalls } = createBrokerHarness();

    const first = await broker.subscribe("graph-1");
    assert.equal(listenCalls(), 1);

    const second = await broker.subscribe("graph-1");
    assert.equal(listenCalls(), 1);

    await first.return();
    assert.equal(unlistenCalls(), 0);

    await second.return();
    assert.equal(unlistenCalls(), 1);
  });

  await t.test("routes notifications by graph id", async () => {
    const { broker, emit } = createBrokerHarness();

    const alpha = await broker.subscribe("alpha");
    const beta = await broker.subscribe("beta");

    const alphaNext = alpha.next();
    const betaNext = beta.next();

    emit("alpha", 2n);
    emit("beta", 3n);

    assert.deepEqual(await alphaNext, {
      done: false,
      value: {
        compositionRevision: 2n,
        graphId: "alpha",
      },
    });
    assert.deepEqual(await betaNext, {
      done: false,
      value: {
        compositionRevision: 3n,
        graphId: "beta",
      },
    });

    await alpha.return();
    await beta.return();
  });

  await t.test(
    "uses latest-only buffering for slow subscribers without blocking fast ones",
    async () => {
      const { broker, emit } = createBrokerHarness();

      const slow = await broker.subscribe("graph-1");
      const fast = await broker.subscribe("graph-1");

      const fastFirst = fast.next();
      emit("graph-1", 1n);
      emit("graph-1", 2n);

      assert.deepEqual(await fastFirst, {
        done: false,
        value: {
          compositionRevision: 1n,
          graphId: "graph-1",
        },
      });

      assert.deepEqual(await slow.next(), {
        done: false,
        value: {
          compositionRevision: 2n,
          graphId: "graph-1",
        },
      });

      const fastSecond = fast.next();
      assert.deepEqual(await fastSecond, {
        done: false,
        value: {
          compositionRevision: 2n,
          graphId: "graph-1",
        },
      });

      const fastThird = fast.next();
      emit("graph-1", 3n);

      assert.deepEqual(await fastThird, {
        done: false,
        value: {
          compositionRevision: 3n,
          graphId: "graph-1",
        },
      });

      await slow.return();
      await fast.return();
    },
  );

  await t.test("rejects concurrent next calls for one subscriber", async () => {
    const { broker, emit } = createBrokerHarness();

    const subscriber = await broker.subscribe("graph-1");
    const firstNext = subscriber.next();

    await assert.rejects(async () => {
      await subscriber.next();
    }, /Concurrent next\(\) calls are not supported/);

    emit("graph-1", 4n);
    assert.deepEqual(await firstNext, {
      done: false,
      value: {
        compositionRevision: 4n,
        graphId: "graph-1",
      },
    });

    await subscriber.return();
  });

  await t.test("close resolves pending subscribers and unlistens once", async () => {
    const { broker, unlistenCalls } = createBrokerHarness();

    const first = await broker.subscribe("graph-1");
    const second = await broker.subscribe("graph-2");

    const firstNext = first.next();
    const secondNext = second.next();

    await broker.close();

    assert.deepEqual(await firstNext, { done: true, value: undefined });
    assert.deepEqual(await secondNext, { done: true, value: undefined });
    assert.equal(unlistenCalls(), 1);
  });
});
