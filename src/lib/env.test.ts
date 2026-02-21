import assert from "node:assert/strict";
import test from "node:test";

import { parseEnv } from "./env.ts";

const TEST_DATABASE_URL = "postgresql://user:password@example.com:5432/database";

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
    const parsedEnv = parseEnv({
      DATABASE_URL: TEST_DATABASE_URL,
    });

    assert.strictEqual(parsedEnv.host, "0.0.0.0");
  });

  await t.test("uses configured value", () => {
    const parsedEnv = parseEnv({
      DATABASE_URL: TEST_DATABASE_URL,
      HOST: "127.0.0.1",
    });

    assert.strictEqual(parsedEnv.host, "127.0.0.1");
  });

  await t.test("throws for empty values", () => {
    assertParseEnvThrows(
      {
        DATABASE_URL: TEST_DATABASE_URL,
        HOST: "   ",
      },
      /HOST: Too small/,
    );
  });
});

await test("parseEnv PORT", async (t) => {
  await t.test("uses default value when unset", () => {
    const parsedEnv = parseEnv({
      DATABASE_URL: TEST_DATABASE_URL,
    });

    assert.strictEqual(parsedEnv.port, 3000);
  });

  await t.test("parses numeric values", () => {
    const parsedEnv = parseEnv({
      DATABASE_URL: TEST_DATABASE_URL,
      PORT: "8080",
    });

    assert.strictEqual(parsedEnv.port, 8080);
  });

  await t.test("throws for non-numeric values", () => {
    assertParseEnvThrows(
      {
        DATABASE_URL: TEST_DATABASE_URL,
        PORT: "abc",
      },
      /PORT: Invalid input/,
    );
  });

  await t.test("throws for out-of-range values", () => {
    assertParseEnvThrows(
      {
        DATABASE_URL: TEST_DATABASE_URL,
        PORT: "70000",
      },
      /PORT: Too big/,
    );
  });
});

await test("parseEnv DATABASE_URL", async (t) => {
  await t.test("uses configured value", () => {
    const parsedEnv = parseEnv({
      DATABASE_URL: TEST_DATABASE_URL,
    });

    assert.strictEqual(parsedEnv.databaseUrl, TEST_DATABASE_URL);
  });

  await t.test("throws when unset", () => {
    assertParseEnvThrows({}, /DATABASE_URL: Invalid input/);
  });

  await t.test("throws for empty values", () => {
    assertParseEnvThrows(
      {
        DATABASE_URL: "   ",
      },
      /DATABASE_URL: Too small/,
    );
  });
});
