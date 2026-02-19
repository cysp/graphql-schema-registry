import assert from "node:assert/strict";
import test from "node:test";

import { parseEnv } from "./env.ts";

await test("parseEnv", async (t) => {
  await t.test("PORT", async (t) => {
    await t.test("uses default value when unset", () => {
      const parsedEnv = parseEnv({});

      assert.strictEqual(parsedEnv.port, 3000);
    });

    await t.test("parses numeric values", () => {
      const parsedEnv = parseEnv({
        PORT: "8080",
      });

      assert.strictEqual(parsedEnv.port, 8080);
    });

    await t.test("throws for non-numeric values", () => {
      assert.throws(
        () => {
          parseEnv({
            PORT: "abc",
          });
        },
        {
          message: /PORT: Invalid input/,
        },
      );
    });

    await t.test("throws for out-of-range values", () => {
      assert.throws(
        () => {
          parseEnv({
            PORT: "70000",
          });
        },
        {
          message: /PORT: Too big/,
        },
      );
    });
  });
});
