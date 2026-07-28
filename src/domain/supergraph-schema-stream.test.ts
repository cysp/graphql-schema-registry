import assert from "node:assert/strict";
import test from "node:test";

import { formatStrongETag } from "./etag.ts";
import {
  formatSupergraphSchemaSnapshot,
  resolveSupergraphSchemaStreamCursor,
  writeSupergraphSchemaSseEvent,
  writeSupergraphSchemaSseHeartbeat,
} from "./supergraph-schema-stream.ts";

class FakeSseWritable {
  destroyed = false;
  readonly #listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  readonly #onceListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  writableEnded = false;
  writes: string[] = [];
  #writeResults: boolean[];

  constructor(writeResults: boolean[] = []) {
    this.#writeResults = writeResults;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const listeners = this.#listeners.get(event);
    const onceListeners = this.#onceListeners.get(event);

    for (const listener of listeners ?? []) {
      listener(...args);
    }

    for (const listener of onceListeners ?? []) {
      listener(...args);
    }

    this.#onceListeners.delete(event);
    return (listeners?.size ?? 0) + (onceListeners?.size ?? 0) > 0;
  }

  end(): this {
    this.writableEnded = true;
    this.emit("finish");
    this.emit("close");
    return this;
  }

  once(event: string, listener: (...args: unknown[]) => void): this {
    const listeners = this.#onceListeners.get(event) ?? new Set();
    listeners.add(listener);
    this.#onceListeners.set(event, listeners);
    return this;
  }

  removeListener(event: string, listener: (...args: unknown[]) => void): this {
    this.#listeners.get(event)?.delete(listener);
    this.#onceListeners.get(event)?.delete(listener);

    return this;
  }

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return this.#writeResults.shift() ?? true;
  }
}

await test("supergraph schema stream helpers", async (t) => {
  await t.test("formats a snapshot with a strong etag", async () => {
    assert.deepEqual(
      formatSupergraphSchemaSnapshot({
        compositionRevision: 3n,
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        graphId: "graph-1",
        supergraphSdl: "type Query { products: [String!]! }",
        supergraphSdlSha256: Buffer.alloc(32),
      }),
      {
        compositionRevision: 3n,
        etag: formatStrongETag("graph-1", 3),
        graphId: "graph-1",
        supergraphSdl: "type Query { products: [String!]! }",
      },
    );
  });

  await t.test("resolves a matching strong Last-Event-ID cursor", async () => {
    assert.deepEqual(
      resolveSupergraphSchemaStreamCursor(formatStrongETag("graph-1", 4), "graph-1"),
      {
        lastSeenRevision: 4n,
        lastSentEtag: formatStrongETag("graph-1", 4),
      },
    );
  });

  await t.test("treats a different graph's Last-Event-ID as unusable but non-fatal", async () => {
    assert.deepEqual(
      resolveSupergraphSchemaStreamCursor(formatStrongETag("graph-2", 4), "graph-1"),
      {
        lastSeenRevision: undefined,
        lastSentEtag: undefined,
      },
    );
  });

  await t.test("rejects weak and wildcard Last-Event-ID values", async () => {
    assert.throws(
      () => resolveSupergraphSchemaStreamCursor(`W/${formatStrongETag("graph-1", 2)}`, "graph-1"),
      /single strong entity-tag value/,
    );
    assert.throws(
      () => resolveSupergraphSchemaStreamCursor("*", "graph-1"),
      /single entity-tag value/,
    );
  });

  await t.test("writes a schema frame as one SSE event", async () => {
    const writable = new FakeSseWritable();

    await writeSupergraphSchemaSseEvent(
      writable,
      formatStrongETag("graph-1", 1),
      "type Query {\n  products: [String!]!\n}",
    );

    assert.deepEqual(writable.writes, [
      `id: ${formatStrongETag("graph-1", 1)}\nevent: schema\ndata: type Query {\ndata:   products: [String!]!\ndata: }\n\n`,
    ]);
  });

  await t.test("waits for drain when the socket applies backpressure", async () => {
    const writable = new FakeSseWritable([false]);
    const writePromise = writeSupergraphSchemaSseHeartbeat(writable);

    await new Promise<void>((resolve) => {
      setImmediate(() => {
        writable.emit("drain");
        resolve();
      });
    });

    await writePromise;
    assert.deepEqual(writable.writes, [": heartbeat\n\n"]);
  });

  await t.test("fails when the socket closes before drain", async () => {
    const writable = new FakeSseWritable([false]);
    const writePromise = writeSupergraphSchemaSseHeartbeat(writable);

    await new Promise<void>((resolve) => {
      setImmediate(() => {
        writable.destroyed = true;
        writable.emit("close");
        resolve();
      });
    });

    await assert.rejects(async () => writePromise, /closed before write drain/);
  });
});
