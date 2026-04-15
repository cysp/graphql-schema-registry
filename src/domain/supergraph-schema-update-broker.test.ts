import assert from "node:assert/strict";
import test from "node:test";

import {
  createSupergraphSchemaUpdateBroker,
  type SupergraphSchemaUpdateBroker,
} from "./supergraph-schema-update-broker.ts";
import {
  encodeSupergraphSchemaUpdatedNotification,
  type SupergraphSchemaUpdatedNotification,
} from "./supergraph-schema-updates.ts";

function createBrokerHarness(): {
  broker: SupergraphSchemaUpdateBroker;
  emit: (graphId: string, revision: bigint) => void;
  emitRaw: (payload: string) => void;
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
    emitRaw(payload) {
      onnotify?.(payload);
    },
    listenCalls: () => listenCallCount,
    unlistenCalls: () => unlistenCallCount,
  };
}

function createFailingNotificationsHarness(): {
  broker: SupergraphSchemaUpdateBroker;
  emit: (notification: SupergraphSchemaUpdatedNotification) => void;
  fail: (error: Error) => void;
} {
  const queue: SupergraphSchemaUpdatedNotification[] = [];
  let closed = false;
  let nextError: Error | undefined;
  let waiter:
    | {
        reject: (error: Error) => void;
        resolve: (result: IteratorResult<SupergraphSchemaUpdatedNotification, void>) => void;
      }
    | undefined;

  const iterator: AsyncGenerator<SupergraphSchemaUpdatedNotification, void, void> = {
    [Symbol.asyncIterator]() {
      return iterator;
    },
    async [Symbol.asyncDispose](): Promise<void> {
      await iterator.return();
    },
    async next(): Promise<IteratorResult<SupergraphSchemaUpdatedNotification, void>> {
      if (queue.length > 0) {
        const notification = queue.shift();
        if (!notification) {
          throw new Error("Notification queue unexpectedly returned no value.");
        }

        return {
          done: false,
          value: notification,
        };
      }

      if (nextError) {
        const error = nextError;
        nextError = undefined;
        throw new Error(error.message, { cause: error });
      }

      if (closed) {
        return {
          done: true,
          value: undefined,
        };
      }

      return new Promise<IteratorResult<SupergraphSchemaUpdatedNotification, void>>(
        (resolve, reject) => {
          waiter = { reject, resolve };
        },
      );
    },
    async return(): Promise<IteratorResult<SupergraphSchemaUpdatedNotification, void>> {
      closed = true;
      if (waiter) {
        waiter.resolve({
          done: true,
          value: undefined,
        });
        waiter = undefined;
      }

      return {
        done: true,
        value: undefined,
      };
    },
    async throw(error: unknown): Promise<IteratorResult<SupergraphSchemaUpdatedNotification, void>> {
      closed = true;
      if (waiter) {
        waiter.reject(error instanceof Error ? error : new Error(String(error)));
        waiter = undefined;
      }

      throw error instanceof Error ? error : new Error(String(error));
    },
  };

  const broker = createSupergraphSchemaUpdateBroker(async () => {
    return {
      async unlisten() {
        closed = true;
      },
    };
  }, {
    createNotifications: async () => iterator,
  });

  return {
    broker,
    emit(notification) {
      if (waiter) {
        waiter.resolve({
          done: false,
          value: notification,
        });
        waiter = undefined;
        return;
      }

      queue.push(notification);
    },
    fail(error) {
      if (waiter) {
        waiter.reject(error);
        waiter = undefined;
        return;
      }

      nextError = error;
    },
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

  await t.test("routes notifications by graph id and ignores malformed payloads", async () => {
    const { broker, emit, emitRaw } = createBrokerHarness();

    const alpha = await broker.subscribe("alpha");
    const beta = await broker.subscribe("beta");

    const alphaNext = alpha.next();
    const betaNext = beta.next();

    emitRaw("not-json");
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
      emit("graph-1", 2n);
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

  await t.test("unexpected listener failure ends active subscribers and future subscriptions", async () => {
    const { broker, fail } = createFailingNotificationsHarness();

    const first = await broker.subscribe("graph-1");
    const second = await broker.subscribe("graph-2");

    const firstNext = first.next();
    const secondNext = second.next();

    fail(new Error("listener failed"));

    assert.deepEqual(await firstNext, { done: true, value: undefined });
    assert.deepEqual(await secondNext, { done: true, value: undefined });
    await assert.rejects(async () => broker.subscribe("graph-3"), /listener failed/);
  });
});
