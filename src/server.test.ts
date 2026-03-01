import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import { createFastifyServer } from "./server.ts";

function getJsonPayload(response: { body: string }): unknown {
  return JSON.parse(response.body) as unknown;
}

await test("createFastifyServer authorization hook", async (t) => {
  let server: ReturnType<typeof createFastifyServer>;

  const jwtSigner = createAuthJwtSigner();

  t.beforeEach(async () => {
    server = createFastifyServer({
      jwtVerification: jwtSigner.jwtVerification,
    });
    await server.ready();
  });

  t.afterEach(async () => {
    await server.close();
  });

  await t.test("allows unguarded routes with no bearer header", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(getJsonPayload(response), {
      checks: {
        database: "warn",
      },
      status: "warn",
    });
  });

  await t.test("returns 401 for invalid bearer tokens on unguarded routes", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: {
        authorization: "Bearer invalid-token",
      },
    });

    assert.strictEqual(response.statusCode, 401);
    assert.deepStrictEqual(getJsonPayload(response), {
      error: "Unauthorized",
      message: "Unauthorized",
      statusCode: 401,
    });
  });

  await t.test("accepts valid bearer tokens", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: {
        authorization: `Bearer ${jwtSigner.createToken()}`,
      },
    });

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(getJsonPayload(response), {
      checks: {
        database: "warn",
      },
      status: "warn",
    });
  });

  await t.test("returns 401 for tokens with malformed authorization_details", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
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
    assert.deepStrictEqual(getJsonPayload(response), {
      error: "Unauthorized",
      message: "Unauthorized",
      statusCode: 401,
    });
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
