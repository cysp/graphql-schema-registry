import assert from "node:assert/strict";
import test from "node:test";

import fastify, { type FastifyInstance } from "fastify";

import { problemDetailsErrorHandler } from "../problem-details/error-handler.ts";
import { problemDetailsPlugin } from "../problem-details/plugin.ts";
import {
  assertBadRequest,
  assertJsonContentType,
  createGraphBody,
  defaultedOperationHandlers,
  graph,
  ifMatchHeaders,
  jsonHeaders,
  updateGraphBody,
} from "./plugin.test-support.ts";
import { openApiRoutesPlugin } from "./plugin.ts";

await test("openApiRoutesPlugin: graph routes", async (t) => {
  let server: FastifyInstance;

  t.beforeEach(() => {
    server = fastify();
    server.register(problemDetailsPlugin);
    server.setErrorHandler(problemDetailsErrorHandler);
  });

  t.afterEach(async () => {
    await server.close();
  });

  await t.test("GET /v1/graphs", async (t) => {
    await t.test("dispatches to the listGraphs handler", async () => {
      let calls = 0;

      server.register(openApiRoutesPlugin, {
        operationHandlers: defaultedOperationHandlers({
          listGraphs: () => {
            calls += 1;
            return [graph];
          },
        }),
      });
      await server.ready();

      const response = await server.inject({
        method: "GET",
        url: "/v1/graphs",
      });

      assert.equal(calls, 1);
      assert.equal(response.statusCode, 200);
      assertJsonContentType(response);
      assert.deepEqual(response.json(), [graph]);
    });
  });

  await t.test("POST /v1/graphs", async (t) => {
    await t.test("rejects requests without a body", async () => {
      let calls = 0;

      server.register(openApiRoutesPlugin, {
        operationHandlers: defaultedOperationHandlers({
          createGraph: () => {
            calls += 1;
            return graph;
          },
        }),
      });
      await server.ready();

      const response = await server.inject({
        method: "POST",
        url: "/v1/graphs",
      });

      assertBadRequest(response);
      assert.equal(calls, 0);
    });

    await t.test("rejects requests with an invalid body", async () => {
      let calls = 0;

      server.register(openApiRoutesPlugin, {
        operationHandlers: defaultedOperationHandlers({
          createGraph: () => {
            calls += 1;
            return graph;
          },
        }),
      });
      await server.ready();

      const response = await server.inject({
        method: "POST",
        url: "/v1/graphs",
        headers: jsonHeaders,
        payload: {},
      });

      assertBadRequest(response);
      assert.equal(calls, 0);
    });

    await t.test("passes a validated body to the handler", async () => {
      let receivedBody: unknown;

      server.register(openApiRoutesPlugin, {
        operationHandlers: defaultedOperationHandlers({
          createGraph: (request, reply) => {
            receivedBody = request.body;
            reply.code(201);
            return graph;
          },
        }),
      });
      await server.ready();

      const response = await server.inject({
        method: "POST",
        url: "/v1/graphs",
        headers: jsonHeaders,
        payload: createGraphBody,
      });

      assert.equal(response.statusCode, 201);
      assertJsonContentType(response);
      assert.deepEqual(receivedBody, createGraphBody);
      assert.deepEqual(response.json(), graph);
    });
  });

  await t.test("GET /v1/graphs/:graphSlug", async (t) => {
    await t.test("passes graphSlug to the handler", async () => {
      let receivedGraphSlug: string | undefined;

      server.register(openApiRoutesPlugin, {
        operationHandlers: defaultedOperationHandlers({
          getGraph: (request) => {
            receivedGraphSlug = request.params.graphSlug;
            return graph;
          },
        }),
      });
      await server.ready();

      const response = await server.inject({
        method: "GET",
        url: "/v1/graphs/inventory",
      });

      assert.equal(response.statusCode, 200);
      assertJsonContentType(response);
      assert.equal(receivedGraphSlug, "inventory");
      assert.deepEqual(response.json(), graph);
    });
  });

  await t.test("PUT /v1/graphs/:graphSlug", async (t) => {
    await t.test("passes validated params and body to the handler without If-Match", async () => {
      let receivedGraphSlug: string | undefined;
      let receivedIfMatch: string | string[] | undefined;
      let receivedBody: unknown;

      server.register(openApiRoutesPlugin, {
        operationHandlers: defaultedOperationHandlers({
          updateGraph: (request) => {
            receivedGraphSlug = request.params.graphSlug;
            receivedIfMatch = request.headers["if-match"];
            receivedBody = request.body;
            return graph;
          },
        }),
      });
      await server.ready();

      const response = await server.inject({
        method: "PUT",
        url: "/v1/graphs/inventory",
        headers: jsonHeaders,
        payload: updateGraphBody,
      });

      assert.equal(response.statusCode, 200);
      assertJsonContentType(response);
      assert.equal(receivedGraphSlug, "inventory");
      assert.equal(receivedIfMatch, undefined);
      assert.deepEqual(receivedBody, updateGraphBody);
      assert.deepEqual(response.json(), graph);
    });

    await t.test("passes validated params, headers, and body to the handler", async () => {
      let receivedGraphSlug: string | undefined;
      let receivedIfMatch: string | string[] | undefined;
      let receivedBody: unknown;

      server.register(openApiRoutesPlugin, {
        operationHandlers: defaultedOperationHandlers({
          updateGraph: (request) => {
            receivedGraphSlug = request.params.graphSlug;
            receivedIfMatch = request.headers["if-match"];
            receivedBody = request.body;
            return graph;
          },
        }),
      });
      await server.ready();

      const response = await server.inject({
        method: "PUT",
        url: "/v1/graphs/inventory",
        headers: {
          ...jsonHeaders,
          ...ifMatchHeaders,
        },
        payload: updateGraphBody,
      });

      assert.equal(response.statusCode, 200);
      assertJsonContentType(response);
      assert.equal(receivedGraphSlug, "inventory");
      assert.equal(receivedIfMatch, ifMatchHeaders["if-match"]);
      assert.deepEqual(receivedBody, updateGraphBody);
      assert.deepEqual(response.json(), graph);
    });
  });

  await t.test("DELETE /v1/graphs/:graphSlug", async (t) => {
    await t.test("passes validated params to the handler without If-Match", async () => {
      let receivedGraphSlug: string | undefined;
      let receivedIfMatch: string | string[] | undefined;

      server.register(openApiRoutesPlugin, {
        operationHandlers: defaultedOperationHandlers({
          deleteGraph: (request, reply) => {
            receivedGraphSlug = request.params.graphSlug;
            receivedIfMatch = request.headers["if-match"];
            reply.code(204);
            return reply.send();
          },
        }),
      });
      await server.ready();

      const response = await server.inject({
        method: "DELETE",
        url: "/v1/graphs/inventory",
      });

      assert.equal(response.statusCode, 204);
      assert.equal(receivedGraphSlug, "inventory");
      assert.equal(receivedIfMatch, undefined);
      assert.equal(response.body, "");
    });

    await t.test("passes validated params and headers to the handler", async () => {
      let receivedGraphSlug: string | undefined;
      let receivedIfMatch: string | string[] | undefined;

      server.register(openApiRoutesPlugin, {
        operationHandlers: defaultedOperationHandlers({
          deleteGraph: (request, reply) => {
            receivedGraphSlug = request.params.graphSlug;
            receivedIfMatch = request.headers["if-match"];
            reply.code(204);
            return reply.send();
          },
        }),
      });
      await server.ready();

      const response = await server.inject({
        method: "DELETE",
        url: "/v1/graphs/inventory",
        headers: ifMatchHeaders,
      });

      assert.equal(response.statusCode, 204);
      assert.equal(receivedGraphSlug, "inventory");
      assert.equal(receivedIfMatch, ifMatchHeaders["if-match"]);
      assert.equal(response.body, "");
    });
  });
});
