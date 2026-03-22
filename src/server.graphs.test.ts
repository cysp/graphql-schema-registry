import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import {
  assertProtectedRouteBehavior,
  jsonHeaders,
  type RouteRequest,
} from "./server.route.test-support.ts";
import { createFastifyServer } from "./server.ts";

const graphReadGrant = {
  graph_id: "graph-1",
  scope: "graph:read",
  type: authorizationDetailsType,
} as const;

await test("server: graph routes", async (t) => {
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

  function createAdminToken(): string {
    return createToken({
      authorization_details: [
        {
          scope: "admin",
          type: authorizationDetailsType,
        },
      ],
    });
  }

  function createGraphReadToken(): string {
    return createToken({
      authorization_details: [graphReadGrant],
    });
  }

  await t.test("GET /v1/graphs", async (t) => {
    const request = {
      method: "GET",
      url: "/v1/graphs",
    } as const satisfies RouteRequest;

    await assertProtectedRouteBehavior(t, {
      adminExpectedStatus: 503,
      adminExpectedTitle: "Service Unavailable",
      createAdminToken,
      forbiddenDescription: "graph:read users",
      forbiddenToken: createGraphReadToken(),
      request,
      server,
    });
  });

  await t.test("POST /v1/graphs", async (t) => {
    const request = {
      method: "POST",
      url: "/v1/graphs",
      headers: jsonHeaders,
      payload: {
        federationVersion: "2",
        slug: "graph-1",
      },
    } as const satisfies RouteRequest;

    await assertProtectedRouteBehavior(t, {
      adminExpectedStatus: 503,
      adminExpectedTitle: "Service Unavailable",
      createAdminToken,
      forbiddenDescription: "graph:read users",
      forbiddenToken: createGraphReadToken(),
      request,
      server,
    });
  });

  await t.test("GET /v1/graphs/:graphSlug", async (t) => {
    const request = {
      method: "GET",
      url: "/v1/graphs/graph-1",
    } as const satisfies RouteRequest;

    await assertProtectedRouteBehavior(t, {
      adminExpectedStatus: 503,
      adminExpectedTitle: "Service Unavailable",
      createAdminToken,
      forbiddenDescription: "graph:read users",
      forbiddenToken: createGraphReadToken(),
      request,
      server,
    });
  });

  await t.test("PUT /v1/graphs/:graphSlug", async (t) => {
    const request = {
      method: "PUT",
      url: "/v1/graphs/graph-1",
      headers: jsonHeaders,
      payload: {
        federationVersion: "2",
      },
    } as const satisfies RouteRequest;

    await assertProtectedRouteBehavior(t, {
      adminExpectedStatus: 503,
      adminExpectedTitle: "Service Unavailable",
      createAdminToken,
      forbiddenDescription: "graph:read users",
      forbiddenToken: createGraphReadToken(),
      request,
      server,
    });
  });

  await t.test("DELETE /v1/graphs/:graphSlug", async (t) => {
    const request = {
      method: "DELETE",
      url: "/v1/graphs/graph-1",
    } as const satisfies RouteRequest;

    await assertProtectedRouteBehavior(t, {
      adminExpectedStatus: 503,
      adminExpectedTitle: "Service Unavailable",
      createAdminToken,
      forbiddenDescription: "graph:read users",
      forbiddenToken: createGraphReadToken(),
      request,
      server,
    });
  });
});
