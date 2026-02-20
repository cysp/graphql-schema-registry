import assert from "node:assert/strict";
import test from "node:test";

import { parseEnv } from "./env.ts";

function assertParseEnvThrows(env: NodeJS.ProcessEnv, message: RegExp): void {
  assert.throws(
    () => {
      parseEnv(env);
    },
    {
      message,
    },
  );
}

await test("parseEnv HOST", async (t) => {
  await t.test("uses default value when unset", () => {
    const parsedEnv = parseEnv({});

    assert.strictEqual(parsedEnv.host, "0.0.0.0");
  });

  await t.test("uses configured value", () => {
    const parsedEnv = parseEnv({
      HOST: "127.0.0.1",
    });

    assert.strictEqual(parsedEnv.host, "127.0.0.1");
  });

  await t.test("throws for empty values", () => {
    assertParseEnvThrows(
      {
        HOST: "   ",
      },
      /HOST: Too small/,
    );
  });
});

await test("parseEnv PORT", async (t) => {
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
    assertParseEnvThrows(
      {
        PORT: "abc",
      },
      /PORT: Invalid input/,
    );
  });

  await t.test("throws for out-of-range values", () => {
    assertParseEnvThrows(
      {
        PORT: "70000",
      },
      /PORT: Too big/,
    );
  });
});
