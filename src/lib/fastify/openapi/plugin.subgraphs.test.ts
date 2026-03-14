import assert from "node:assert/strict";
import test from "node:test";

import fastify, { type FastifyInstance } from "fastify";

import { problemDetailsErrorHandler } from "../problem-details/error-handler.ts";
import { problemDetailsPlugin } from "../problem-details/plugin.ts";
import {
  assertBadRequest,
  assertJsonContentType,
  createSubgraphBody,
  defaultedOperationHandlers,
  ifMatchHeaders,
  jsonHeaders,
  subgraph,
  updateSubgraphBody,
} from "./plugin.test-support.ts";
import { openApiRoutesPlugin } from "./plugin.ts";

await test("openApiRoutesPlugin: subgraph routes", async (t) => {
  let server: FastifyInstance;

  t.beforeEach(() => {
    server = fastify();
    server.register(problemDetailsPlugin);
    server.setErrorHandler(problemDetailsErrorHandler);
  });

  t.afterEach(async () => {
    await server.close();
  });

  await t.test("GET /v1/graphs/:graphSlug/subgraphs", async (t) => {
    await t.test("passes graphSlug to the handler", async () => {
      let receivedGraphSlug: string | undefined;

      server.register(openApiRoutesPlugin, {
        operationHandlers: defaultedOperationHandlers({
          listSubgraphs: (request) => {
            receivedGraphSlug = request.params.graphSlug;
            return [subgraph];
          },
        }),
      });
      await server.ready();

      const response = await server.inject({
        method: "GET",
        url: "/v1/graphs/inventory/subgraphs",
      });

      assert.equal(response.statusCode, 200);
      assertJsonContentType(response);
      assert.equal(receivedGraphSlug, "inventory");
      assert.deepEqual(response.json(), [subgraph]);
    });
  });

  await t.test("POST /v1/graphs/:graphSlug/subgraphs", async (t) => {
    await t.test("rejects requests with an empty slug", async () => {
      let calls = 0;

      server.register(openApiRoutesPlugin, {
        operationHandlers: defaultedOperationHandlers({
          createSubgraph: () => {
            calls += 1;
            return subgraph;
          },
        }),
      });
      await server.ready();

      const response = await server.inject({
        method: "POST",
        url: "/v1/graphs/inventory/subgraphs",
        headers: jsonHeaders,
        payload: {
          ...createSubgraphBody,
          slug: "",
        },
      });

      assertBadRequest(response);
      assert.equal(calls, 0);
    });

    await t.test("passes validated params and body to the handler", async () => {
      let receivedGraphSlug: string | undefined;
      let receivedBody: unknown;

      server.register(openApiRoutesPlugin, {
        operationHandlers: defaultedOperationHandlers({
          createSubgraph: (request, reply) => {
            receivedGraphSlug = request.params.graphSlug;
            receivedBody = request.body;
            reply.code(201);
            return subgraph;
          },
        }),
      });
      await server.ready();

      const response = await server.inject({
        method: "POST",
        url: "/v1/graphs/inventory/subgraphs",
        headers: jsonHeaders,
        payload: createSubgraphBody,
      });

      assert.equal(response.statusCode, 201);
      assertJsonContentType(response);
      assert.equal(receivedGraphSlug, "inventory");
      assert.deepEqual(receivedBody, createSubgraphBody);
      assert.deepEqual(response.json(), subgraph);
    });
  });

  await t.test("GET /v1/graphs/:graphSlug/subgraphs/:subgraphSlug", async (t) => {
    await t.test("passes graphSlug and subgraphSlug to the handler", async () => {
      let receivedGraphSlug: string | undefined;
      let receivedSubgraphSlug: string | undefined;

      server.register(openApiRoutesPlugin, {
        operationHandlers: defaultedOperationHandlers({
          getSubgraph: (request) => {
            receivedGraphSlug = request.params.graphSlug;
            receivedSubgraphSlug = request.params.subgraphSlug;
            return subgraph;
          },
        }),
      });
      await server.ready();

      const response = await server.inject({
        method: "GET",
        url: "/v1/graphs/inventory/subgraphs/products",
      });

      assert.equal(response.statusCode, 200);
      assertJsonContentType(response);
      assert.equal(receivedGraphSlug, "inventory");
      assert.equal(receivedSubgraphSlug, "products");
      assert.deepEqual(response.json(), subgraph);
    });
  });

  await t.test("PUT /v1/graphs/:graphSlug/subgraphs/:subgraphSlug", async (t) => {
    await t.test("passes validated params and body to the handler without If-Match", async () => {
      let receivedGraphSlug: string | undefined;
      let receivedSubgraphSlug: string | undefined;
      let receivedIfMatch: string | string[] | undefined;
      let receivedBody: unknown;

      server.register(openApiRoutesPlugin, {
        operationHandlers: defaultedOperationHandlers({
          updateSubgraph: (request) => {
            receivedGraphSlug = request.params.graphSlug;
            receivedSubgraphSlug = request.params.subgraphSlug;
            receivedIfMatch = request.headers["if-match"];
            receivedBody = request.body;
            return subgraph;
          },
        }),
      });
      await server.ready();

      const response = await server.inject({
        method: "PUT",
        url: "/v1/graphs/inventory/subgraphs/products",
        headers: jsonHeaders,
        payload: updateSubgraphBody,
      });

      assert.equal(response.statusCode, 200);
      assertJsonContentType(response);
      assert.equal(receivedGraphSlug, "inventory");
      assert.equal(receivedSubgraphSlug, "products");
      assert.equal(receivedIfMatch, undefined);
      assert.deepEqual(receivedBody, updateSubgraphBody);
      assert.deepEqual(response.json(), subgraph);
    });

    await t.test("passes validated params, headers, and body to the handler", async () => {
      let receivedGraphSlug: string | undefined;
      let receivedSubgraphSlug: string | undefined;
      let receivedIfMatch: string | string[] | undefined;
      let receivedBody: unknown;

      server.register(openApiRoutesPlugin, {
        operationHandlers: defaultedOperationHandlers({
          updateSubgraph: (request) => {
            receivedGraphSlug = request.params.graphSlug;
            receivedSubgraphSlug = request.params.subgraphSlug;
            receivedIfMatch = request.headers["if-match"];
            receivedBody = request.body;
            return subgraph;
          },
        }),
      });
      await server.ready();

      const response = await server.inject({
        method: "PUT",
        url: "/v1/graphs/inventory/subgraphs/products",
        headers: {
          ...jsonHeaders,
          ...ifMatchHeaders,
        },
        payload: updateSubgraphBody,
      });

      assert.equal(response.statusCode, 200);
      assertJsonContentType(response);
      assert.equal(receivedGraphSlug, "inventory");
      assert.equal(receivedSubgraphSlug, "products");
      assert.equal(receivedIfMatch, ifMatchHeaders["if-match"]);
      assert.deepEqual(receivedBody, updateSubgraphBody);
      assert.deepEqual(response.json(), subgraph);
    });
  });

  await t.test("DELETE /v1/graphs/:graphSlug/subgraphs/:subgraphSlug", async (t) => {
    await t.test("passes validated params to the handler without If-Match", async () => {
      let receivedGraphSlug: string | undefined;
      let receivedSubgraphSlug: string | undefined;
      let receivedIfMatch: string | string[] | undefined;

      server.register(openApiRoutesPlugin, {
        operationHandlers: defaultedOperationHandlers({
          deleteSubgraph: (request, reply) => {
            receivedGraphSlug = request.params.graphSlug;
            receivedSubgraphSlug = request.params.subgraphSlug;
            receivedIfMatch = request.headers["if-match"];
            reply.code(204);
            return reply.send();
          },
        }),
      });
      await server.ready();

      const response = await server.inject({
        method: "DELETE",
        url: "/v1/graphs/inventory/subgraphs/products",
      });

      assert.equal(response.statusCode, 204);
      assert.equal(receivedGraphSlug, "inventory");
      assert.equal(receivedSubgraphSlug, "products");
      assert.equal(receivedIfMatch, undefined);
      assert.equal(response.body, "");
    });

    await t.test("passes validated params and headers to the handler", async () => {
      let receivedGraphSlug: string | undefined;
      let receivedSubgraphSlug: string | undefined;
      let receivedIfMatch: string | string[] | undefined;

      server.register(openApiRoutesPlugin, {
        operationHandlers: defaultedOperationHandlers({
          deleteSubgraph: (request, reply) => {
            receivedGraphSlug = request.params.graphSlug;
            receivedSubgraphSlug = request.params.subgraphSlug;
            receivedIfMatch = request.headers["if-match"];
            reply.code(204);
            return reply.send();
          },
        }),
      });
      await server.ready();

      const response = await server.inject({
        method: "DELETE",
        url: "/v1/graphs/inventory/subgraphs/products",
        headers: ifMatchHeaders,
      });

      assert.equal(response.statusCode, 204);
      assert.equal(receivedGraphSlug, "inventory");
      assert.equal(receivedSubgraphSlug, "products");
      assert.equal(receivedIfMatch, ifMatchHeaders["if-match"]);
      assert.equal(response.body, "");
    });
  });
});
