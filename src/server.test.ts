import assert from "node:assert/strict";
import test from "node:test";

import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import { createFastifyServer } from "./server.ts";

function getJsonPayload(response: { body: string }): unknown {
  return JSON.parse(response.body) as unknown;
}

const unauthorizedResponsePayload = {
  error: "Unauthorized",
  message: "Unauthorized",
  statusCode: 401,
};

await test("server: /", async (t) => {
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

  await t.test("returns 401 for missing bearer token", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/",
    });

    assert.strictEqual(response.statusCode, 401);
    assert.deepStrictEqual(getJsonPayload(response), unauthorizedResponsePayload);
  });

  await t.test("returns 401 for invalid bearer token", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/",
      headers: {
        authorization: "Bearer invalid-token",
      },
    });

    assert.strictEqual(response.statusCode, 401);
    assert.deepStrictEqual(getJsonPayload(response), unauthorizedResponsePayload);
  });

  await t.test("accepts valid bearer token", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/",
      headers: {
        authorization: `Bearer ${createToken()}`,
      },
    });

    assert.strictEqual(response.statusCode, 204);
    assert.strictEqual(response.body, "");
  });

  await t.test("accepts valid lowercase bearer token", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/",
      headers: {
        authorization: `bearer ${createToken()}`,
      },
    });

    assert.strictEqual(response.statusCode, 204);
    assert.strictEqual(response.body, "");
  });

  await t.test("returns 401 for malformed authorization_details", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/",
      headers: {
        authorization: `Bearer ${createToken({
          authorization_details: {
            scope: "admin",
            type: "graphql-schema-registry",
          },
        })}`,
      },
    });

    assert.strictEqual(response.statusCode, 401);
    assert.deepStrictEqual(getJsonPayload(response), unauthorizedResponsePayload);
  });
});
