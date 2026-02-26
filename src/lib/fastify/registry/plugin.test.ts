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
  expectedToken: string;
  wrongToken: string;
};

type InjectOptions = {
  body?: Buffer | NodeJS.ReadableStream | Record<string, unknown> | string;
  headers?: {
    authorization: string;
  };
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
    options.headers = {
      authorization: authorizationToken,
    };
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
      grants: [{ graphId: "alpha", scope: "graph:read" }],
    },
    subgraphAlphaInventoryWrite: {
      grants: [{ graphId: "alpha", scope: "subgraph:write", subgraphId: "inventory" }],
    },
  };

  const routeCases: readonly RouteCase[] = [
    {
      body: {
        graphId: "alpha",
      },
      expectedToken: "admin",
      method: "POST",
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
      expectedToken: "admin",
      method: "PUT",
      url: "/v1/graphs/alpha",
      wrongToken: "graphAlphaRead",
    },
    {
      body: {
        subgraphId: "inventory",
      },
      expectedToken: "admin",
      method: "POST",
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
      method: "PUT",
      url: "/v1/graphs/alpha/subgraphs/inventory/schema.graphql",
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

  await t.test("authorized tokens receive 501 with empty body on all routes", async () => {
    for (const routeCase of routeCases) {
      const response = await server.inject(createInjectOptions(routeCase, routeCase.expectedToken));

      assert.strictEqual(response.statusCode, 501);
      assert.strictEqual(response.body, "");
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
});
