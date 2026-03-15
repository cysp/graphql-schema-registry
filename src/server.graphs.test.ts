import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import { createFastifyServer } from "./server.ts";

function getJsonPayload(response: { body: string }): unknown {
  return JSON.parse(response.body) as unknown;
}

type GraphRouteRequest = {
  name: string;
  request: {
    headers?: Record<string, string>;
    method: "DELETE" | "GET" | "POST" | "PUT";
    payload?: Record<string, string>;
    url: string;
  };
};

function createAuthorizedRequest(
  request: GraphRouteRequest["request"],
  token: string,
): GraphRouteRequest["request"] {
  return {
    ...request,
    headers:
      request.headers === undefined
        ? { authorization: `Bearer ${token}` }
        : {
            ...request.headers,
            authorization: `Bearer ${token}`,
          },
  };
}

function assertProblemPayload(payload: unknown, status: number, title: string): void {
  assert.deepStrictEqual(payload, {
    type: "about:blank",
    status,
    title,
  });
}

const graphRouteRequests = [
  {
    name: "GET /v1/graphs",
    request: {
      method: "GET",
      url: "/v1/graphs",
    },
  },
  {
    name: "POST /v1/graphs",
    request: {
      method: "POST",
      url: "/v1/graphs",
      headers: {
        "content-type": "application/json",
      },
      payload: {
        federationVersion: "2",
        slug: "graph-1",
      },
    },
  },
  {
    name: "GET /v1/graphs/:graphSlug",
    request: {
      method: "GET",
      url: "/v1/graphs/graph-1",
    },
  },
  {
    name: "PUT /v1/graphs/:graphSlug",
    request: {
      method: "PUT",
      url: "/v1/graphs/graph-1",
      headers: {
        "content-type": "application/json",
      },
      payload: {
        federationVersion: "2",
      },
    },
  },
  {
    name: "DELETE /v1/graphs/:graphSlug",
    request: {
      method: "DELETE",
      url: "/v1/graphs/graph-1",
    },
  },
] as const satisfies readonly GraphRouteRequest[];

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

  async function assertGraphRouteBehavior({ name, request }: GraphRouteRequest): Promise<void> {
    await t.test(`${name} returns 401 without auth`, async () => {
      const unauthorizedResponse = await server.inject(request);

      assert.strictEqual(unauthorizedResponse.statusCode, 401);
      assert.strictEqual(unauthorizedResponse.headers["www-authenticate"], "Bearer");
      assertProblemPayload(getJsonPayload(unauthorizedResponse), 401, "Unauthorized");
    });

    await t.test(`${name} returns 403 for authenticated non-admin users`, async () => {
      const authenticatedNonAdminResponse = await server.inject(
        createAuthorizedRequest(request, createToken()),
      );

      assert.strictEqual(authenticatedNonAdminResponse.statusCode, 403);
      assertProblemPayload(getJsonPayload(authenticatedNonAdminResponse), 403, "Forbidden");
    });

    await t.test(`${name} reaches the handler for admin users`, async () => {
      const authorizedResponse = await server.inject(
        createAuthorizedRequest(
          request,
          createToken({
            authorization_details: [
              {
                scope: "admin",
                type: authorizationDetailsType,
              },
            ],
          }),
        ),
      );

      assert.strictEqual(authorizedResponse.statusCode, 501);
      assertProblemPayload(getJsonPayload(authorizedResponse), 501, "Not Implemented");
    });
  }

  for (const routeRequest of graphRouteRequests) {
    await assertGraphRouteBehavior(routeRequest);
  }
});
