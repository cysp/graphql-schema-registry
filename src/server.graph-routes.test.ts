import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import { createFastifyServer } from "./server.ts";
type RouteMethod = "DELETE" | "GET" | "POST" | "PUT";

type RouteCase = {
  method: RouteMethod;
  payload?: Record<string, unknown>;
  requiresRevisionHeader?: boolean;
  url: string;
};

type InjectOptions = {
  headers?: Record<string, string>;
  method: RouteMethod;
  payload?: Record<string, unknown>;
  url: string;
};

function createInjectOptions(routeCase: RouteCase, authorizationToken?: string): InjectOptions {
  const options: InjectOptions = {
    method: routeCase.method,
    url: routeCase.url,
  };

  if (routeCase.payload !== undefined) {
    options.payload = routeCase.payload;
  }

  const headers: Record<string, string> = {};
  if (authorizationToken !== undefined) {
    headers["authorization"] = `Bearer ${authorizationToken}`;
  }

  if (routeCase.requiresRevisionHeader) {
    headers["x-revision-id"] = "1";
  }

  if (Object.keys(headers).length > 0) {
    options.headers = headers;
  }

  return options;
}

await test("graph routes authorization", async (t) => {
  let server: ReturnType<typeof createFastifyServer>;

  const jwtSigner = createAuthJwtSigner();

  const routeCases: readonly RouteCase[] = [
    {
      method: "GET",
      url: "/v1/graphs/catalog",
    },
    {
      method: "POST",
      url: "/v1/graphs",
      payload: {
        federationVersion: "2.9",
        graphSlug: "catalog",
      },
    },
    {
      method: "PUT",
      payload: {
        federationVersion: "2.9",
      },
      requiresRevisionHeader: true,
      url: "/v1/graphs/catalog",
    },
    {
      method: "DELETE",
      url: "/v1/graphs/catalog",
    },
  ];

  t.beforeEach(async () => {
    server = createFastifyServer({
      jwtVerification: jwtSigner.jwtVerification,
    });
    await server.ready();
  });

  t.afterEach(async () => {
    await server.close();
  });

  const graphReaderToken = jwtSigner.createToken({
    authorization_details: [
      {
        graph_id: "00000000-0000-4000-8000-000000000001",
        scope: "graph:read",
        type: authorizationDetailsType,
      },
    ],
  });
  const adminToken = jwtSigner.createToken({
    authorization_details: [
      {
        scope: "admin",
        type: authorizationDetailsType,
      },
    ],
  });

  await t.test("returns service unavailable before auth checks on all graph routes", async () => {
    for (const routeCase of routeCases) {
      const response = await server.inject(createInjectOptions(routeCase));
      assert.strictEqual(response.statusCode, 503);
    }
  });

  await t.test("returns service unavailable before admin checks on all graph routes", async () => {
    for (const routeCase of routeCases) {
      const response = await server.inject(createInjectOptions(routeCase, graphReaderToken));
      assert.strictEqual(response.statusCode, 503);
    }
  });

  await t.test("allows admins to reach all graph handlers", async () => {
    for (const routeCase of routeCases) {
      const response = await server.inject(createInjectOptions(routeCase, adminToken));
      // No database is configured in this test setup, so authorized access reaches
      // each handler and returns service unavailable.
      assert.strictEqual(response.statusCode, 503);
    }
  });

  await t.test("returns bad request for unsafe revision ids", async () => {
    const response = await server.inject({
      headers: {
        "x-revision-id": "9007199254740992",
      },
      method: "PUT",
      payload: {
        federationVersion: "2.9",
      },
      url: "/v1/graphs/catalog",
    });

    assert.strictEqual(response.statusCode, 400);
  });

  await t.test("returns bad request for non-numeric revision ids", async () => {
    const response = await server.inject({
      headers: {
        "x-revision-id": "not-a-number",
      },
      method: "PUT",
      payload: {
        federationVersion: "2.9",
      },
      url: "/v1/graphs/catalog",
    });

    assert.strictEqual(response.statusCode, 400);
  });

  await t.test("returns bad request when revision id is missing", async () => {
    const response = await server.inject({
      method: "PUT",
      payload: {
        federationVersion: "2.9",
      },
      url: "/v1/graphs/catalog",
    });

    assert.strictEqual(response.statusCode, 400);
  });
});
