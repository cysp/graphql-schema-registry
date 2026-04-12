import assert from "node:assert/strict";
import test from "node:test";

import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import { createFastifyServer } from "./server.ts";

function getJsonPayload(response: { body: string }): unknown {
  return JSON.parse(response.body) as unknown;
}

const healthResponsePayload = {
  checks: {
    database: "warn",
  },
  status: "warn",
};

await test("server: /health", async (t) => {
  let server: ReturnType<typeof createFastifyServer>;

  const { createToken, jwtVerification } = createAuthJwtSigner();

  t.beforeEach(async () => {
    server = createFastifyServer({
      jwtVerification,
    });
    await server.ready();
  });

  t.afterEach(async () => {
    await server.close();
  });

  await t.test("allows requests with no bearer header", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(getJsonPayload(response), healthResponsePayload);
  });

  await t.test("ignores invalid bearer tokens", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: {
        authorization: "Bearer invalid-token",
      },
    });

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(getJsonPayload(response), healthResponsePayload);
  });

  await t.test("ignores valid bearer tokens", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: {
        authorization: `Bearer ${createToken()}`,
      },
    });

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(getJsonPayload(response), healthResponsePayload);
  });

  await t.test("ignores malformed authorization_details", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: {
        authorization: `Bearer ${createToken({
          authorization_details: {
            graph_id: "*",
            scope: "graph:manage",
            type: "graphql-schema-registry",
          },
        })}`,
      },
    });

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(getJsonPayload(response), healthResponsePayload);
  });
});
