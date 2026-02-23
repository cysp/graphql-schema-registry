// oxlint-disable typescript-eslint/no-misused-promises

import assert from "node:assert/strict";
import test from "node:test";

import fastifySensible from "@fastify/sensible";
import fastify, { type FastifyInstance } from "fastify";

import type { RequestUser } from "../../../domain/authorization/user.ts";
import { requireAdmin, requireGraphRead, requireSubgraphWrite } from "./guards.ts";

type UsersByToken = Readonly<Record<string, RequestUser>>;

function parseBearerToken(headerValue: string | string[] | undefined): string | undefined {
  if (typeof headerValue !== "string") {
    return undefined;
  }

  const [scheme, token] = headerValue.split(" ", 2);
  if (scheme !== "Bearer" || !token) {
    return undefined;
  }

  return token;
}

function getJsonPayload(response: { body: string }): unknown {
  return JSON.parse(response.body) as unknown;
}

function assertUnauthorized(response: { statusCode: number; body: string }): void {
  assert.strictEqual(response.statusCode, 401);
  assert.deepStrictEqual(getJsonPayload(response), {
    error: "Unauthorized",
    message: "Unauthorized",
    statusCode: 401,
  });
}

function assertForbidden(response: { statusCode: number; body: string }): void {
  assert.strictEqual(response.statusCode, 403);
  assert.deepStrictEqual(getJsonPayload(response), {
    error: "Forbidden",
    message: "Forbidden",
    statusCode: 403,
  });
}

function assertOk(response: { statusCode: number; body: string }): void {
  assert.strictEqual(response.statusCode, 200);
  assert.deepStrictEqual(getJsonPayload(response), {
    ok: true,
  });
}

await test("authorization guards", async (t) => {
  let server: FastifyInstance;

  const usersByToken: UsersByToken = {
    admin: {
      grants: [{ scope: "admin" }],
    },
    graphAlphaRead: {
      grants: [{ graphId: "alpha", scope: "graph:read" }],
    },
    subgraphAlphaInventoryWrite: {
      grants: [{ graphId: "alpha", scope: "subgraph:write", subgraphId: "inventory" }],
    },
  };

  t.beforeEach(async () => {
    server = fastify();

    server.register(fastifySensible);
    server.decorateRequest("user");

    server.addHook("onRequest", (request, _reply, done) => {
      request.user = undefined;

      const bearerToken = parseBearerToken(request.headers.authorization);
      if (bearerToken) {
        request.user = usersByToken[bearerToken];
      }

      done();
    });

    server.get("/admin", { preHandler: requireAdmin }, () => ({
      ok: true,
    }));

    server.get("/graphs/:graphId/read", { preHandler: requireGraphRead }, () => ({
      ok: true,
    }));

    server.get(
      "/graphs/:graphId/subgraphs/:subgraphId/write",
      { preHandler: requireSubgraphWrite },
      () => ({
        ok: true,
      }),
    );

    await server.ready();
  });

  t.afterEach(async () => {
    await server.close();
  });

  await t.test("requireAdmin returns 401 when no user exists", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/admin",
    });

    assertUnauthorized(response);
  });

  await t.test("requireAdmin allows admin grants", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/admin",
      headers: {
        authorization: "Bearer admin",
      },
    });

    assertOk(response);
  });

  await t.test("requireAdmin returns 403 for non-admin grants", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/admin",
      headers: {
        authorization: "Bearer graphAlphaRead",
      },
    });

    assertForbidden(response);
  });

  await t.test("requireGraphRead returns 401 when no user exists", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/alpha/read",
    });

    assertUnauthorized(response);
  });

  await t.test("requireGraphRead allows matching graph:read grant", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/alpha/read",
      headers: {
        authorization: "Bearer graphAlphaRead",
      },
    });

    assertOk(response);
  });

  await t.test("requireGraphRead rejects same user on a different graph", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/beta/read",
      headers: {
        authorization: "Bearer graphAlphaRead",
      },
    });

    assertForbidden(response);
  });

  await t.test("requireGraphRead rejects subgraph:write grants", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/alpha/read",
      headers: {
        authorization: "Bearer subgraphAlphaInventoryWrite",
      },
    });

    assertForbidden(response);
  });

  await t.test("requireGraphRead rejects admin grants", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/alpha/read",
      headers: {
        authorization: "Bearer admin",
      },
    });

    assertForbidden(response);
  });

  await t.test("requireSubgraphWrite returns 401 when no user exists", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/alpha/subgraphs/inventory/write",
    });

    assertUnauthorized(response);
  });

  await t.test("requireSubgraphWrite allows exact graph/subgraph match", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/alpha/subgraphs/inventory/write",
      headers: {
        authorization: "Bearer subgraphAlphaInventoryWrite",
      },
    });

    assertOk(response);
  });

  await t.test("requireSubgraphWrite rejects mismatched graph", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/beta/subgraphs/inventory/write",
      headers: {
        authorization: "Bearer subgraphAlphaInventoryWrite",
      },
    });

    assertForbidden(response);
  });

  await t.test("requireSubgraphWrite rejects mismatched subgraph", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/alpha/subgraphs/orders/write",
      headers: {
        authorization: "Bearer subgraphAlphaInventoryWrite",
      },
    });

    assertForbidden(response);
  });

  await t.test("requireSubgraphWrite rejects graph:read grants", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/alpha/subgraphs/inventory/write",
      headers: {
        authorization: "Bearer graphAlphaRead",
      },
    });

    assertForbidden(response);
  });

  await t.test("requireSubgraphWrite rejects admin grants", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/alpha/subgraphs/inventory/write",
      headers: {
        authorization: "Bearer admin",
      },
    });

    assertForbidden(response);
  });
});
