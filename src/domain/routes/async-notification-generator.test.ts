import assert from "node:assert/strict";
import test from "node:test";

import { createAsyncNotificationGenerator } from "./async-notification-generator.ts";

await test("createAsyncNotificationGenerator", async (t) => {
  await t.test(
    "yields decoded notifications in order and ignores undecodable payloads",
    async () => {
      let onnotify: ((payload: string) => void) | undefined;
      let unlistenCount = 0;

      const iterator = await createAsyncNotificationGenerator(
        async (_channel, listener) => {
          onnotify = listener;
          return {
            async unlisten() {
              unlistenCount += 1;
            },
          };
        },
        "supergraph_schema_updates",
        (payload) => (payload.startsWith("schema:") ? payload.slice("schema:".length) : undefined),
      );

      onnotify?.("schema:first");
      onnotify?.("ignored");
      onnotify?.("schema:second");

      assert.deepEqual(await iterator.next(), { done: false, value: "first" });
      assert.deepEqual(await iterator.next(), { done: false, value: "second" });

      await iterator.return();
      assert.equal(unlistenCount, 1);
    },
  );

  await t.test("return resolves a pending next and unlistens exactly once", async () => {
    let onnotify: ((payload: string) => void) | undefined;
    let unlistenCount = 0;

    const iterator = await createAsyncNotificationGenerator(
      async (_channel, listener) => {
        onnotify = listener;
        return {
          async unlisten() {
            unlistenCount += 1;
          },
        };
      },
      "supergraph_schema_updates",
      (payload) => payload,
    );

    const pendingNext = iterator.next();
    assert.ok(onnotify);

    assert.deepEqual(await iterator.return(), { done: true, value: undefined });
    assert.deepEqual(await pendingNext, { done: true, value: undefined });
    assert.equal(unlistenCount, 1);

    assert.deepEqual(await iterator.return(), { done: true, value: undefined });
    assert.equal(unlistenCount, 1);
  });
});
