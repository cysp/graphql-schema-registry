import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
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

await test("server: /user/grants", async (t) => {
  let server: ReturnType<typeof createFastifyServer>;

  const { createToken, jwtVerification } = createJwtFixture();

  t.beforeEach(async () => {
    server = createFastifyServer({
      jwtVerification,
    });
    await server.ready();
  });

  t.afterEach(async () => {
    await server.close();
  });

  await t.test("returns 401 for missing bearer tokens", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/user/grants",
    });

    assert.strictEqual(response.statusCode, 401);
    assert.deepStrictEqual(getJsonPayload(response), unauthorizedResponsePayload);
  });

  await t.test("returns 401 for invalid bearer tokens", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/user/grants",
      headers: {
        authorization: "Bearer invalid-token",
      },
    });

    assert.strictEqual(response.statusCode, 401);
    assert.deepStrictEqual(getJsonPayload(response), unauthorizedResponsePayload);
  });

  await t.test("returns decoded grants for valid bearer tokens", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/user/grants",
      headers: {
        authorization: `Bearer ${createToken({
          authorization_details: [
            {
              scope: "admin",
              type: authorizationDetailsType,
            },
            {
              graph_id: "graph-1",
              scope: "graph:read",
              type: authorizationDetailsType,
            },
            {
              graph_id: "graph-2",
              scope: "subgraph:write",
              subgraph_id: "subgraph-a",
              type: authorizationDetailsType,
            },
          ],
        })}`,
      },
    });

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(getJsonPayload(response), [
      {
        scope: "admin",
      },
      {
        graphId: "graph-1",
        scope: "graph:read",
      },
      {
        graphId: "graph-2",
        scope: "subgraph:write",
        subgraphId: "subgraph-a",
      },
    ]);
  });

  await t.test("returns decoded grants for valid lowercase bearer tokens", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/user/grants",
      headers: {
        authorization: `bearer ${createToken({
          authorization_details: [
            {
              scope: "admin",
              type: authorizationDetailsType,
            },
          ],
        })}`,
      },
    });

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(getJsonPayload(response), [
      {
        scope: "admin",
      },
    ]);
  });

  await t.test("returns 401 for malformed authorization_details", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/user/grants",
      headers: {
        authorization: `Bearer ${createToken({
          authorization_details: {
            scope: "admin",
            type: authorizationDetailsType,
          },
        })}`,
      },
    });

    assert.strictEqual(response.statusCode, 401);
    assert.deepStrictEqual(getJsonPayload(response), unauthorizedResponsePayload);
  });
});
