import assert from "node:assert/strict";
import test from "node:test";

import { etagSatisfiesIfMatch, formatStrongETag, parseIfMatchHeader } from "./etag.ts";

await test("etag helpers", async (t) => {
  await t.test("formats strong etags from resource ids and revision ids", () => {
    assert.equal(formatStrongETag("graph-1", 2), '"graph-1:2"');
  });

  await t.test("parses wildcard if-match values", () => {
    assert.deepEqual(parseIfMatchHeader("*"), {
      kind: "any",
    });
  });

  await t.test("matches strong tags from comma-separated values", () => {
    const condition = parseIfMatchHeader('"graph-1:1", "graph-1:2", W/"graph-1:3"');

    assert.equal(etagSatisfiesIfMatch(condition, '"graph-1:2"'), true);
  });

  await t.test("does not match weak tags", () => {
    const condition = parseIfMatchHeader('W/"graph-1:2"');

    assert.equal(etagSatisfiesIfMatch(condition, '"graph-1:2"'), false);
  });

  await t.test("supports repeated header values", () => {
    const condition = parseIfMatchHeader(['W/"graph-1:1"', '"graph-1:3"']);

    assert.equal(etagSatisfiesIfMatch(condition, '"graph-1:3"'), true);
  });

  await t.test("supports commas inside quoted entity-tags", () => {
    const condition = parseIfMatchHeader('"graph,1:2", W/"graph,1:3"');

    assert.equal(etagSatisfiesIfMatch(condition, '"graph,1:2"'), true);
  });

  await t.test("fails preconditions for missing resources when if-match is present", () => {
    assert.equal(etagSatisfiesIfMatch(parseIfMatchHeader("*"), undefined), false);
    assert.equal(etagSatisfiesIfMatch(parseIfMatchHeader('"graph-1:2"'), undefined), false);
    assert.equal(etagSatisfiesIfMatch(undefined, undefined), true);
  });
});
