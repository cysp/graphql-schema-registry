// oxlint-disable typescript-eslint/no-misused-promises

import assert from "node:assert/strict";
import test from "node:test";

import fastifySensible from "@fastify/sensible";
import fastify, { type FastifyInstance } from "fastify";

import type { RequestUser } from "../../../domain/authorization/user.ts";
import { parseAuthorizationToken } from "./auth-helpers.ts";
import { requireAdmin, requireGraphRead, requireSubgraphWrite } from "./guards.ts";

type UsersByToken = Readonly<Record<string, RequestUser>>;

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

      const authorizationToken = parseAuthorizationToken(request.headers.authorization);
      if (authorizationToken) {
        request.user = usersByToken[authorizationToken];
      }

      done();
    });

    server.get("/admin", { preHandler: requireAdmin }, () => ({
      ok: true,
    }));

    server.get("/graphs/:graphSlug/read", { preHandler: requireGraphRead }, () => ({
      ok: true,
    }));

    server.get(
      "/graphs/:graphSlug/subgraphs/:subgraphSlug/write",
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

    assert.strictEqual(response.statusCode, 401);
  });

  await t.test("requireAdmin allows admin grants", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/admin",
      headers: {
        authorization: "admin",
      },
    });

    assert.strictEqual(response.statusCode, 200);
  });

  await t.test("requireAdmin returns 403 for non-admin grants", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/admin",
      headers: {
        authorization: "graphAlphaRead",
      },
    });

    assert.strictEqual(response.statusCode, 403);
  });

  await t.test("requireGraphRead returns 401 when no user exists", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/alpha/read",
    });

    assert.strictEqual(response.statusCode, 401);
  });

  await t.test("requireGraphRead allows matching graph:read grant", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/alpha/read",
      headers: {
        authorization: "graphAlphaRead",
      },
    });

    assert.strictEqual(response.statusCode, 200);
  });

  await t.test("requireGraphRead rejects same user on a different graph", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/beta/read",
      headers: {
        authorization: "graphAlphaRead",
      },
    });

    assert.strictEqual(response.statusCode, 403);
  });

  await t.test("requireGraphRead rejects subgraph:write grants", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/alpha/read",
      headers: {
        authorization: "subgraphAlphaInventoryWrite",
      },
    });

    assert.strictEqual(response.statusCode, 403);
  });

  await t.test("requireGraphRead rejects admin grants", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/alpha/read",
      headers: {
        authorization: "admin",
      },
    });

    assert.strictEqual(response.statusCode, 403);
  });

  await t.test("requireSubgraphWrite returns 401 when no user exists", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/alpha/subgraphs/inventory/write",
    });

    assert.strictEqual(response.statusCode, 401);
  });

  await t.test("requireSubgraphWrite allows exact graph/subgraph match", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/alpha/subgraphs/inventory/write",
      headers: {
        authorization: "subgraphAlphaInventoryWrite",
      },
    });

    assert.strictEqual(response.statusCode, 200);
  });

  await t.test("requireSubgraphWrite rejects mismatched graph", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/beta/subgraphs/inventory/write",
      headers: {
        authorization: "subgraphAlphaInventoryWrite",
      },
    });

    assert.strictEqual(response.statusCode, 403);
  });

  await t.test("requireSubgraphWrite rejects mismatched subgraph", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/alpha/subgraphs/orders/write",
      headers: {
        authorization: "subgraphAlphaInventoryWrite",
      },
    });

    assert.strictEqual(response.statusCode, 403);
  });

  await t.test("requireSubgraphWrite rejects graph:read grants", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/alpha/subgraphs/inventory/write",
      headers: {
        authorization: "graphAlphaRead",
      },
    });

    assert.strictEqual(response.statusCode, 403);
  });

  await t.test("requireSubgraphWrite rejects admin grants", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/graphs/alpha/subgraphs/inventory/write",
      headers: {
        authorization: "admin",
      },
    });

    assert.strictEqual(response.statusCode, 403);
  });
});
