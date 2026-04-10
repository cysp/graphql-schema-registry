import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import {
  assertProblemResponse,
  createAuthorizedRequest,
  type RouteRequest,
} from "./server.route.test-support.ts";
import { createFastifyServer } from "./server.ts";

const subgraphSchemaReadGrant = {
  graph_id: "graph-1",
  scope: "subgraph-schema:read",
  subgraph_id: "products",
  type: authorizationDetailsType,
} as const;

const subgraphSchemaWriteGrant = {
  graph_id: "graph-1",
  scope: "subgraph-schema:write",
  subgraph_id: "products",
  type: authorizationDetailsType,
} as const;

await test("server: subgraph schema routes", async (t) => {
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

  function createSchemaReadToken(): string {
    return createToken({
      authorization_details: [subgraphSchemaReadGrant],
    });
  }

  function createSchemaWriteToken(): string {
    return createToken({
      authorization_details: [subgraphSchemaWriteGrant],
    });
  }

  await t.test("GET /v1/graphs/:graphSlug/subgraphs/:subgraphSlug/schema.graphqls", async (t) => {
    const request = {
      method: "GET",
      url: "/v1/graphs/graph-1/subgraphs/products/schema.graphqls",
    } as const satisfies RouteRequest;

    await t.test("returns 401 without auth", async () => {
      const response = await server.inject(request);
      assertProblemResponse(response, 401, "Unauthorized");
    });

    await t.test("returns 503 for admin users before authorization can be resolved", async () => {
      const response = await server.inject(createAuthorizedRequest(request, createAdminToken()));
      assertProblemResponse(response, 503, "Service Unavailable");
    });

    await t.test(
      "returns 503 for schema write users before authorization can be resolved",
      async () => {
        const response = await server.inject(
          createAuthorizedRequest(request, createSchemaWriteToken()),
        );
        assertProblemResponse(response, 503, "Service Unavailable");
      },
    );

    await t.test("returns 503 for matching schema read users when database is absent", async () => {
      const response = await server.inject(
        createAuthorizedRequest(request, createSchemaReadToken()),
      );
      assertProblemResponse(response, 503, "Service Unavailable");
    });
  });

  await t.test("POST /v1/graphs/:graphSlug/subgraphs/:subgraphSlug/schema.graphqls", async (t) => {
    const request = {
      headers: {
        "content-type": "text/plain",
      },
      method: "POST",
      payload: "type Query { products: [String!]! }",
      url: "/v1/graphs/graph-1/subgraphs/products/schema.graphqls",
    } as const satisfies RouteRequest;

    await t.test("returns 401 without auth", async () => {
      const response = await server.inject(request);
      assertProblemResponse(response, 401, "Unauthorized");
    });

    await t.test("returns 503 for admin users before authorization can be resolved", async () => {
      const response = await server.inject(createAuthorizedRequest(request, createAdminToken()));
      assertProblemResponse(response, 503, "Service Unavailable");
    });

    await t.test(
      "returns 503 for schema read users before authorization can be resolved",
      async () => {
        const response = await server.inject(
          createAuthorizedRequest(request, createSchemaReadToken()),
        );
        assertProblemResponse(response, 503, "Service Unavailable");
      },
    );

    await t.test(
      "returns 503 for matching schema write users when database is absent",
      async () => {
        const response = await server.inject(
          createAuthorizedRequest(request, createSchemaWriteToken()),
        );
        assertProblemResponse(response, 503, "Service Unavailable");
      },
    );
  });

  await t.test(
    "DELETE /v1/graphs/:graphSlug/subgraphs/:subgraphSlug/schema.graphqls",
    async (t) => {
      const request = {
        method: "DELETE",
        url: "/v1/graphs/graph-1/subgraphs/products/schema.graphqls",
      } as const satisfies RouteRequest;

      await t.test("returns 401 without auth", async () => {
        const response = await server.inject(request);
        assertProblemResponse(response, 401, "Unauthorized");
      });

      await t.test("returns 503 for admin users before authorization can be resolved", async () => {
        const response = await server.inject(createAuthorizedRequest(request, createAdminToken()));
        assertProblemResponse(response, 503, "Service Unavailable");
      });

      await t.test(
        "returns 503 for schema read users before authorization can be resolved",
        async () => {
          const response = await server.inject(
            createAuthorizedRequest(request, createSchemaReadToken()),
          );
          assertProblemResponse(response, 503, "Service Unavailable");
        },
      );

      await t.test(
        "returns 503 for matching schema write users when database is absent",
        async () => {
          const response = await server.inject(
            createAuthorizedRequest(request, createSchemaWriteToken()),
          );
          assertProblemResponse(response, 503, "Service Unavailable");
        },
      );
    },
  );
});
