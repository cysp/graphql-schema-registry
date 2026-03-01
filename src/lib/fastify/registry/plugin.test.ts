// oxlint-disable typescript-eslint/no-misused-promises

import assert from "node:assert/strict";
import test from "node:test";

import fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

import { registryPlugin } from "./plugin.ts";

type RouteCase = {
  method: "DELETE" | "GET" | "POST" | "PUT";
  url: string;
  body?: Buffer | NodeJS.ReadableStream | Record<string, unknown> | string;
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

  const routeCases: readonly RouteCase[] = [
    {
      body: {
        graphId: "alpha",
      },
      method: "POST",
      url: "/v1/graphs",
    },
    {
      method: "GET",
      url: "/v1/graphs/alpha",
    },
    {
      method: "DELETE",
      url: "/v1/graphs/alpha",
    },
    {
      method: "PUT",
      url: "/v1/graphs/alpha",
    },
    {
      body: {
        subgraphId: "inventory",
      },
      method: "POST",
      url: "/v1/graphs/alpha/subgraphs",
    },
    {
      method: "GET",
      url: "/v1/graphs/alpha/subgraphs/inventory",
    },
    {
      method: "DELETE",
      url: "/v1/graphs/alpha/subgraphs/inventory",
    },
    {
      method: "PUT",
      url: "/v1/graphs/alpha/subgraphs/inventory",
    },
    {
      method: "GET",
      url: "/v1/graphs/alpha/supergraph.graphqls",
    },
    {
      method: "PUT",
      url: "/v1/graphs/alpha/subgraphs/inventory/schema.graphql",
    },
  ];

  t.beforeEach(async () => {
    server = fastify();
    server.setValidatorCompiler(validatorCompiler);
    server.setSerializerCompiler(serializerCompiler);

    server.register(registryPlugin);
    await server.ready();
  });

  t.afterEach(async () => {
    await server.close();
  });

  await t.test("requests with auth headers receive 501 with empty body on all routes", async () => {
    for (const routeCase of routeCases) {
      const response = await server.inject(createInjectOptions(routeCase, "admin"));

      assert.strictEqual(response.statusCode, 501);
      assert.strictEqual(response.body, "");
    }
  });

  await t.test("missing tokens receive 501 on all routes", async () => {
    for (const routeCase of routeCases) {
      const response = await server.inject(createInjectOptions(routeCase));

      assert.strictEqual(response.statusCode, 501);
      assert.strictEqual(response.body, "");
    }
  });

  await t.test("non-bearer tokens still receive 501 on all routes", async () => {
    for (const routeCase of routeCases) {
      const response = await server.inject(createInjectOptions(routeCase, "graphAlphaRead"));

      assert.strictEqual(response.statusCode, 501);
      assert.strictEqual(response.body, "");
    }
  });
});
