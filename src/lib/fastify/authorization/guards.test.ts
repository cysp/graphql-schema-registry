import assert from "node:assert/strict";
import test from "node:test";

import fastifySensible from "@fastify/sensible";
import fastify, { type FastifyInstance } from "fastify";

import type { RequestUser } from "../../../domain/authorization/user.ts";
import { parseAuthorizationToken } from "./auth-helpers.ts";
import { requireAdminUser } from "./guards.ts";

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

    server.get("/admin", (request, reply) => {
      if (!requireAdminUser(request, reply)) {
        return;
      }

      return {
        ok: true,
      };
    });

    await server.ready();
  });

  t.afterEach(async () => {
    await server.close();
  });

  await t.test("requireAdminUser returns 401 when no user exists", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/admin",
    });

    assert.strictEqual(response.statusCode, 401);
  });

  await t.test("requireAdminUser allows admin grants", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/admin",
      headers: {
        authorization: "admin",
      },
    });

    assert.strictEqual(response.statusCode, 200);
  });

  await t.test("requireAdminUser returns 403 for non-admin grants", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/admin",
      headers: {
        authorization: "graphAlphaRead",
      },
    });

    assert.strictEqual(response.statusCode, 403);
  });
});
