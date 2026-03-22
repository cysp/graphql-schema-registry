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

const subgraphWriteGrant = {
  graph_id: "graph-1",
  scope: "subgraph:write",
  subgraph_id: "products",
  type: authorizationDetailsType,
} as const;

await test("server: subgraph routes", async (t) => {
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

  function createSubgraphWriteToken(): string {
    return createToken({
      authorization_details: [subgraphWriteGrant],
    });
  }

  await t.test("GET /v1/graphs/:graphSlug/subgraphs", async (t) => {
    const request = {
      method: "GET",
      url: "/v1/graphs/graph-1/subgraphs",
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

  await t.test("POST /v1/graphs/:graphSlug/subgraphs", async (t) => {
    const request = {
      method: "POST",
      url: "/v1/graphs/graph-1/subgraphs",
      headers: jsonHeaders,
      payload: {
        routingUrl: "https://example.com/graphql",
        slug: "products",
      },
    } as const satisfies RouteRequest;

    await assertProtectedRouteBehavior(t, {
      adminExpectedStatus: 503,
      adminExpectedTitle: "Service Unavailable",
      createAdminToken,
      forbiddenDescription: "subgraph:write users",
      forbiddenToken: createSubgraphWriteToken(),
      request,
      server,
    });
  });

  await t.test("GET /v1/graphs/:graphSlug/subgraphs/:subgraphSlug", async (t) => {
    const request = {
      method: "GET",
      url: "/v1/graphs/graph-1/subgraphs/products",
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

  await t.test("PUT /v1/graphs/:graphSlug/subgraphs/:subgraphSlug", async (t) => {
    const request = {
      method: "PUT",
      url: "/v1/graphs/graph-1/subgraphs/products",
      headers: jsonHeaders,
      payload: {
        routingUrl: "https://example.com/updated-graphql",
      },
    } as const satisfies RouteRequest;

    await assertProtectedRouteBehavior(t, {
      adminExpectedStatus: 503,
      adminExpectedTitle: "Service Unavailable",
      createAdminToken,
      forbiddenDescription: "subgraph:write users",
      forbiddenToken: createSubgraphWriteToken(),
      request,
      server,
    });
  });

  await t.test("DELETE /v1/graphs/:graphSlug/subgraphs/:subgraphSlug", async (t) => {
    const request = {
      method: "DELETE",
      url: "/v1/graphs/graph-1/subgraphs/products",
    } as const satisfies RouteRequest;

    await assertProtectedRouteBehavior(t, {
      adminExpectedStatus: 503,
      adminExpectedTitle: "Service Unavailable",
      createAdminToken,
      forbiddenDescription: "subgraph:write users",
      forbiddenToken: createSubgraphWriteToken(),
      request,
      server,
    });
  });
});
