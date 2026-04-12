import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import { createFastifyServer } from "./server.ts";

function getJsonPayload(response: { body: string }): unknown {
  return JSON.parse(response.body) as unknown;
}

const unauthorizedResponsePayload = {
  type: "about:blank",
  status: 401,
  title: "Unauthorized",
};

await test("server: /user/grants", async (t) => {
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
              graph_id: "*",
              scope: "graph:manage",
              type: authorizationDetailsType,
            },
            {
              graph_id: "graph-1",
              scope: "supergraph_schema:read",
              type: authorizationDetailsType,
            },
            {
              graph_id: "*",
              scope: "subgraph_schema:read",
              subgraph_id: "*",
              type: authorizationDetailsType,
            },
            {
              graph_id: "graph-3",
              scope: "subgraph_schema:read",
              subgraph_id: "subgraph-b",
              type: authorizationDetailsType,
            },
            {
              graph_id: "graph-4",
              scope: "subgraph_schema:write",
              subgraph_id: "subgraph-c",
              type: authorizationDetailsType,
            },
          ],
        })}`,
      },
    });

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(getJsonPayload(response), [
      {
        graphId: "*",
        scope: "graph:manage",
      },
      {
        graphId: "graph-1",
        scope: "supergraph_schema:read",
      },
      {
        graphId: "*",
        scope: "subgraph_schema:read",
        subgraphId: "*",
      },
      {
        graphId: "graph-3",
        scope: "subgraph_schema:read",
        subgraphId: "subgraph-b",
      },
      {
        graphId: "graph-4",
        scope: "subgraph_schema:write",
        subgraphId: "subgraph-c",
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
              graph_id: "*",
              scope: "graph:manage",
              type: authorizationDetailsType,
            },
          ],
        })}`,
      },
    });

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(getJsonPayload(response), [
      {
        graphId: "*",
        scope: "graph:manage",
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
            graph_id: "*",
            scope: "graph:manage",
            type: authorizationDetailsType,
          },
        })}`,
      },
    });

    assert.strictEqual(response.statusCode, 401);
    assert.deepStrictEqual(getJsonPayload(response), unauthorizedResponsePayload);
  });
});
