import assert from "node:assert/strict";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import { assertProblemResponse, createAuthorizedRequest } from "./server.route.test-support.ts";
import { createFastifyServer } from "./server.ts";

const jsonHeaders = {
  "content-type": "application/json",
} as const;

const listGraphsRequest = {
  method: "GET",
  url: "/v1/graphs",
} as const;

const createGraphRequest = {
  headers: jsonHeaders,
  method: "POST",
  payload: {
    slug: "graph-1",
  },
  url: "/v1/graphs",
} as const;

await test("server: graph routes", async (t) => {
  let server: ReturnType<typeof createFastifyServer>;

  const { createToken, jwtVerification } = createAuthJwtSigner();

  t.beforeEach(async () => {
    server = createFastifyServer({
      jwtVerification,
      logger: false,
    });
    await server.ready();
  });

  t.afterEach(async () => {
    await server.close();
  });

  function createGraphManageToken(): string {
    return createToken({
      authorization_details: [
        {
          graph_id: "*",
          scope: "graph:manage",
          type: authorizationDetailsType,
        },
      ],
    });
  }

  function createSupergraphSchemaReadToken(): string {
    return createToken({
      authorization_details: [
        {
          graph_id: "graph-1",
          scope: "supergraph_schema:read",
          type: authorizationDetailsType,
        },
      ],
    });
  }

  await t.test("GET /v1/graphs returns 401 without auth", async () => {
    const response = await server.inject(listGraphsRequest);

    assertProblemResponse(response, 401, "Unauthorized");
    assert.equal(response.headers["www-authenticate"], "Bearer");
  });

  await t.test("POST /v1/graphs rejects non-manage grants before database access", async () => {
    const response = await server.inject(
      createAuthorizedRequest(createGraphRequest, createSupergraphSchemaReadToken()),
    );

    assertProblemResponse(response, 403, "Forbidden");
    assert.equal(response.headers["www-authenticate"], undefined);
  });

  await t.test("POST /v1/graphs accepts wildcard graph:manage before database access", async () => {
    const response = await server.inject(
      createAuthorizedRequest(createGraphRequest, createGraphManageToken()),
    );

    assertProblemResponse(response, 503, "Service Unavailable");
    assert.equal(response.headers["www-authenticate"], undefined);
  });
});
