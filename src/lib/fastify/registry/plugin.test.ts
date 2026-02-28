// oxlint-disable typescript-eslint/no-misused-promises

import assert from "node:assert/strict";
import test from "node:test";

import fastifySensible from "@fastify/sensible";
import fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

import type { RequestUser } from "../../../domain/authorization/user.ts";
import { parseAuthorizationToken } from "../authorization/auth-helpers.ts";
import { registryPlugin } from "./plugin.ts";

type UsersByToken = Readonly<Record<string, RequestUser>>;

type RouteCase = {
  method: "DELETE" | "GET" | "POST" | "PUT";
  url: string;
  body?: Buffer | NodeJS.ReadableStream | Record<string, unknown> | string;
  headers?: Record<string, string>;
  expectedToken: string;
  wrongToken: string;
};

type InjectOptions = {
  body?: Buffer | NodeJS.ReadableStream | Record<string, unknown> | string;
  headers?: Record<string, string>;
  method: RouteCase["method"];
  url: string;
};

function createInjectOptions(routeCase: RouteCase, authorizationToken?: string): InjectOptions {
  const options: InjectOptions = {
    method: routeCase.method,
    url: routeCase.url,
  };

  if (routeCase.body !== undefined) {
    options.body = routeCase.body;
  }

  if (authorizationToken !== undefined) {
    options.headers = Object.assign({}, routeCase.headers, {
      authorization: authorizationToken,
    });
  } else if (routeCase.headers) {
    options.headers = routeCase.headers;
  }

  return options;
}

await test("registry plugin", async (t) => {
  let server: FastifyInstance;

  const usersByToken: UsersByToken = {
    admin: {
      grants: [{ scope: "admin" }],
    },
    graphAlphaRead: {
      grants: [{ graphId: "11111111-1111-4111-8111-111111111111", scope: "graph:read" }],
    },
    subgraphAlphaInventoryWrite: {
      grants: [
        {
          graphId: "11111111-1111-4111-8111-111111111111",
          scope: "subgraph:write",
          subgraphId: "22222222-2222-4222-8222-222222222222",
        },
      ],
    },
  };

  const routeCases: readonly RouteCase[] = [
    {
      expectedToken: "admin",
      method: "GET",
      url: "/v1/graphs",
      wrongToken: "graphAlphaRead",
    },
    {
      expectedToken: "admin",
      method: "GET",
      url: "/v1/graphs/alpha",
      wrongToken: "graphAlphaRead",
    },
    {
      expectedToken: "admin",
      method: "DELETE",
      url: "/v1/graphs/alpha",
      wrongToken: "graphAlphaRead",
    },
    {
      body: {
        federationVersion: "v2.9",
      },
      headers: {
        "x-revision-id": "0",
      },
      expectedToken: "admin",
      method: "PUT",
      url: "/v1/graphs/alpha",
      wrongToken: "graphAlphaRead",
    },
    {
      expectedToken: "admin",
      method: "GET",
      url: "/v1/graphs/alpha/subgraphs",
      wrongToken: "graphAlphaRead",
    },
    {
      expectedToken: "admin",
      method: "GET",
      url: "/v1/graphs/alpha/subgraphs/inventory",
      wrongToken: "graphAlphaRead",
    },
    {
      expectedToken: "admin",
      method: "DELETE",
      url: "/v1/graphs/alpha/subgraphs/inventory",
      wrongToken: "graphAlphaRead",
    },
    {
      body: {
        routingUrl: "https://subgraphs.example.test/inventory",
      },
      headers: {
        "x-revision-id": "0",
      },
      expectedToken: "admin",
      method: "PUT",
      url: "/v1/graphs/alpha/subgraphs/inventory",
      wrongToken: "graphAlphaRead",
    },
    {
      expectedToken: "graphAlphaRead",
      method: "GET",
      url: "/v1/graphs/alpha/supergraph.graphqls",
      wrongToken: "admin",
    },
    {
      expectedToken: "subgraphAlphaInventoryWrite",
      method: "POST",
      url: "/v1/graphs/alpha/subgraphs/inventory/schema.graphqls",
      wrongToken: "admin",
    },
  ];

  t.beforeEach(async () => {
    server = fastify();
    server.setValidatorCompiler(validatorCompiler);
    server.setSerializerCompiler(serializerCompiler);

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

    server.register(registryPlugin);
    await server.ready();
  });

  t.afterEach(async () => {
    await server.close();
  });

  await t.test("authorized tokens reach route handlers", async () => {
    for (const routeCase of routeCases) {
      const response = await server.inject(createInjectOptions(routeCase, routeCase.expectedToken));

      assert.ok([501, 503].includes(response.statusCode));
    }
  });

  await t.test("missing tokens return 401 on all routes", async () => {
    for (const routeCase of routeCases) {
      const response = await server.inject(createInjectOptions(routeCase));

      assert.strictEqual(response.statusCode, 401);
    }
  });

  await t.test("wrong scope tokens return 403 on all routes", async () => {
    for (const routeCase of routeCases) {
      const response = await server.inject(createInjectOptions(routeCase, routeCase.wrongToken));

      assert.strictEqual(response.statusCode, 403);
    }
  });

  await t.test("put routes require a valid x-revision-id header", async () => {
    const graphPutWithoutHeader = await server.inject({
      method: "PUT",
      url: "/v1/graphs/alpha",
      body: {
        federationVersion: "v2.9",
      },
      headers: {
        authorization: "admin",
      },
    });

    assert.strictEqual(graphPutWithoutHeader.statusCode, 422);

    const subgraphPutWithInvalidHeader = await server.inject({
      method: "PUT",
      url: "/v1/graphs/alpha/subgraphs/inventory",
      body: {
        routingUrl: "https://subgraphs.example.test/inventory",
      },
      headers: {
        authorization: "admin",
        "x-revision-id": "-1",
      },
    });

    assert.strictEqual(subgraphPutWithInvalidHeader.statusCode, 422);
  });
});
