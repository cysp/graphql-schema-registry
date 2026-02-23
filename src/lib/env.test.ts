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

await test("parseEnv JWT verification config", async (t) => {
  await t.test("defaults to disabled JWT verification", () => {
    const parsedEnv = parseEnv(withDefaultEnv());

    assert.strictEqual(parsedEnv.jwtVerification, undefined);
  });

  await t.test("parses JWT verification values when fully configured", () => {
    const parsedEnv = parseEnv(
      withDefaultEnv({
        AUTH_JWT_PUBLIC_KEY_PATH: "/run/secrets/service-public-key.pem",
        AUTH_JWT_ISSUER: "https://auth.example.com",
        AUTH_JWT_AUDIENCE: "graphql-schema-registry",
      }),
    );

    assert.deepStrictEqual(parsedEnv.jwtVerification, {
      audience: "graphql-schema-registry",
      issuer: "https://auth.example.com",
      publicKeyPath: "/run/secrets/service-public-key.pem",
    });
  });

  await t.test("throws when AUTH_JWT_PUBLIC_KEY_PATH is set without AUTH_JWT_ISSUER", () => {
    assertParseEnvThrows(
      withDefaultEnv({
        AUTH_JWT_PUBLIC_KEY_PATH: "/run/secrets/service-public-key.pem",
        AUTH_JWT_AUDIENCE: "graphql-schema-registry",
      }),
      /AUTH_JWT_ISSUER: AUTH_JWT_ISSUER is required when AUTH_JWT_PUBLIC_KEY_PATH is set/,
    );
  });

  await t.test("throws when AUTH_JWT_PUBLIC_KEY_PATH is set without AUTH_JWT_AUDIENCE", () => {
    assertParseEnvThrows(
      withDefaultEnv({
        AUTH_JWT_PUBLIC_KEY_PATH: "/run/secrets/service-public-key.pem",
        AUTH_JWT_ISSUER: "https://auth.example.com",
      }),
      /AUTH_JWT_AUDIENCE: AUTH_JWT_AUDIENCE is required when AUTH_JWT_PUBLIC_KEY_PATH is set/,
    );
  });

  await t.test("throws when AUTH_JWT_ISSUER is set without AUTH_JWT_PUBLIC_KEY_PATH", () => {
    assertParseEnvThrows(
      withDefaultEnv({
        AUTH_JWT_ISSUER: "https://auth.example.com",
      }),
      /AUTH_JWT_PUBLIC_KEY_PATH: AUTH_JWT_PUBLIC_KEY_PATH is required when AUTH_JWT_ISSUER is set/,
    );
  });

  await t.test("throws when AUTH_JWT_AUDIENCE is set without AUTH_JWT_PUBLIC_KEY_PATH", () => {
    assertParseEnvThrows(
      withDefaultEnv({
        AUTH_JWT_AUDIENCE: "graphql-schema-registry",
      }),
      /AUTH_JWT_PUBLIC_KEY_PATH: AUTH_JWT_PUBLIC_KEY_PATH is required when AUTH_JWT_AUDIENCE is set/,
    );
  });
});
