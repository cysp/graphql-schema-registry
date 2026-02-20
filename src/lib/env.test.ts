import assert from "node:assert/strict";
import test from "node:test";

import { parseEnv } from "./env.ts";

const defaultEnv: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/graphql_schema_registry",
};

function withDefaultEnv(env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return Object.assign({}, defaultEnv, env);
}

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
    const parsedEnv = parseEnv(withDefaultEnv());

    assert.strictEqual(parsedEnv.host, "0.0.0.0");
  });

  await t.test("uses configured value", () => {
    const parsedEnv = parseEnv(
      withDefaultEnv({
        HOST: "127.0.0.1",
      }),
    );

    assert.strictEqual(parsedEnv.host, "127.0.0.1");
  });

  await t.test("throws for empty values", () => {
    assertParseEnvThrows(
      withDefaultEnv({
        HOST: "   ",
      }),
      /HOST: Too small/,
    );
  });
});

await test("parseEnv PORT", async (t) => {
  await t.test("uses default value when unset", () => {
    const parsedEnv = parseEnv(withDefaultEnv());

    assert.strictEqual(parsedEnv.port, 3000);
  });

  await t.test("parses numeric values", () => {
    const parsedEnv = parseEnv(
      withDefaultEnv({
        PORT: "8080",
      }),
    );

    assert.strictEqual(parsedEnv.port, 8080);
  });

  await t.test("throws for non-numeric values", () => {
    assertParseEnvThrows(
      withDefaultEnv({
        PORT: "abc",
      }),
      /PORT: Invalid input/,
    );
  });

  await t.test("throws for out-of-range values", () => {
    assertParseEnvThrows(
      withDefaultEnv({
        PORT: "70000",
      }),
      /PORT: Too big/,
    );
  });
});

await test("parseEnv DATABASE_URL", async (t) => {
  await t.test("uses configured value", () => {
    const parsedEnv = parseEnv({
      DATABASE_URL: "postgresql://service:secret@localhost:5432/graphql_schema_registry",
    });

    assert.strictEqual(
      parsedEnv.databaseUrl,
      "postgresql://service:secret@localhost:5432/graphql_schema_registry",
    );
  });

  await t.test("returns undefined when missing", () => {
    const parsedEnv = parseEnv({});

    assert.strictEqual(parsedEnv.databaseUrl, undefined);
  });

  await t.test("returns undefined for empty values", () => {
    const parsedEnv = parseEnv({
      DATABASE_URL: "   ",
    });

    assert.strictEqual(parsedEnv.databaseUrl, undefined);
  });
});
