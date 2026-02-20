import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { optionalNonBlankString } from "./zod.ts";

await test("optionalNonBlankString", async (t) => {
  const schema = z.object({
    value: optionalNonBlankString,
  });

  await t.test("preserves non-empty strings", () => {
    const parsedEnv = schema.parse({
      value: "  hello  ",
    });

    assert.strictEqual(parsedEnv.value, "  hello  ");
  });

  await t.test("returns undefined when missing", () => {
    const parsedEnv = schema.parse({});

    assert.strictEqual(parsedEnv.value, undefined);
  });

  await t.test("returns undefined for empty strings", () => {
    const parsedEnv = schema.parse({
      value: "   ",
    });

    assert.strictEqual(parsedEnv.value, undefined);
  });

  await t.test("throws for non-string values", () => {
    assert.throws(
      () => {
        schema.parse({
          value: 1,
        });
      },
      {
        message: /Invalid input/,
      },
    );
  });
});
