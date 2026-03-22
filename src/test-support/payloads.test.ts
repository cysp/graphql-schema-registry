import assert from "node:assert/strict";
import test from "node:test";

import { requireGraphPayload, requireSubgraphPayload } from "./payloads.ts";

await test("requireGraphPayload rejects array payloads", () => {
  assert.throws(
    () => requireGraphPayload([]),
    (error) =>
      error instanceof assert.AssertionError &&
      error.message === "Expected graph payload to be an object.",
  );
});

await test("requireSubgraphPayload rejects array payloads", () => {
  assert.throws(
    () => requireSubgraphPayload([]),
    (error) =>
      error instanceof assert.AssertionError &&
      error.message === "Expected subgraph payload to be an object.",
  );
});
