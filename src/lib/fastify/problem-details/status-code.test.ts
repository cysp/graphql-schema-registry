import assert from "node:assert/strict";
import test from "node:test";

import { coerceProblemDetailsStatusCode, requireProblemDetailsStatusCode } from "./status-code.ts";

await test("coerceProblemDetailsStatusCode accepts only integer 4xx and 5xx statuses", () => {
  assert.equal(coerceProblemDetailsStatusCode(400), 400);
  assert.equal(coerceProblemDetailsStatusCode(599), 599);
  assert.equal(coerceProblemDetailsStatusCode(399), undefined);
  assert.equal(coerceProblemDetailsStatusCode(600), undefined);
  assert.equal(coerceProblemDetailsStatusCode(401.5), undefined);
  assert.equal(coerceProblemDetailsStatusCode(Number.NaN), undefined);
});

await test("requireProblemDetailsStatusCode throws for invalid statuses", () => {
  assert.throws(() => requireProblemDetailsStatusCode(200), TypeError);
  assert.throws(() => requireProblemDetailsStatusCode(401.5), TypeError);
});
