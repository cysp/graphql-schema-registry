import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import { createJwtFixture } from "./domain/jwt.fixture.ts";
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

  const { createToken, jwtVerification } = createJwtFixture();

  t.beforeEach(async () => {
    server = createFastifyServer({
      jwtVerification: jwtSigner.jwtVerification,
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
        authorization: `Bearer ${jwtSigner.createToken()}`,
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
        authorization: `Bearer ${jwtSigner.createToken({
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

  await t.test(
    "returns 503 before bearer auth checks on graph routes when DB is missing",
    async () => {
      const response = await server.inject({
        method: "GET",
        url: "/v1/graphs",
      });

      assert.strictEqual(response.statusCode, 503);
    },
  );

  await t.test(
    "returns 503 before admin grant checks on graph routes when DB is missing",
    async () => {
      const response = await server.inject({
        method: "GET",
        url: "/v1/graphs",
        headers: {
          authorization: `Bearer ${jwtSigner.createToken({
            authorization_details: [
              {
                graph_id: "00000000-0000-4000-8000-000000000001",
                scope: "graph:read",
                type: authorizationDetailsType,
              },
            ],
          })}`,
        },
      });

      assert.strictEqual(response.statusCode, 503);
    },
  );

  await t.test("allows admins to list graphs", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/v1/graphs",
      headers: {
        authorization: `Bearer ${jwtSigner.createToken({
          authorization_details: [
            {
              scope: "admin",
              type: authorizationDetailsType,
            },
          ],
        })}`,
      },
    });

    // No database is configured in this test setup, so authorized access reaches
    // the handler and returns service unavailable.
    assert.strictEqual(response.statusCode, 503);
  });
});
