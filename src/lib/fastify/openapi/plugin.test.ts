import assert from "node:assert/strict";
import test from "node:test";

import fastify, { type FastifyInstance } from "fastify";

import type { OpenApiOperationHandlers } from "./plugin.ts";
import { openApiRoutesPlugin } from "./plugin.ts";

const graph = {
  createdAt: "2026-03-11T00:00:00.000Z",
  federationVersion: "2.5",
  id: "00000000-0000-4000-8000-000000000001",
  revisionId: "1",
  slug: "inventory",
  updatedAt: "2026-03-11T00:00:00.000Z",
};

const subgraph = {
  createdAt: "2026-03-11T00:00:00.000Z",
  graphId: "00000000-0000-4000-8000-000000000001",
  id: "00000000-0000-4000-8000-000000000002",
  revisionId: "1",
  routingUrl: "https://example.com/graphql",
  slug: "products",
  updatedAt: "2026-03-11T00:00:00.000Z",
};

const unexpectedGeneratedOperationHandler = () => {
  throw new Error("Unexpected generated handler call.");
};

function createGeneratedOperationHandlers(
  overrides: Partial<OpenApiOperationHandlers> = {},
): OpenApiOperationHandlers {
  return {
    createGraph: unexpectedGeneratedOperationHandler,
    createSubgraph: unexpectedGeneratedOperationHandler,
    deleteGraph: unexpectedGeneratedOperationHandler,
    deleteSubgraph: unexpectedGeneratedOperationHandler,
    getGraph: unexpectedGeneratedOperationHandler,
    getSubgraph: unexpectedGeneratedOperationHandler,
    listGraphs: unexpectedGeneratedOperationHandler,
    listSubgraphs: unexpectedGeneratedOperationHandler,
    updateGraph: unexpectedGeneratedOperationHandler,
    updateSubgraph: unexpectedGeneratedOperationHandler,
    ...overrides,
  };
}

await test("openApiRoutesPlugin", async (t) => {
  let server: FastifyInstance;

  t.beforeEach(() => {
    server = fastify();
  });

  t.afterEach(async () => {
    await server.close();
  });

  await t.test(
    "registers the current generated GET route and dispatches to its handler",
    async () => {
      let calls = 0;

      server.register(openApiRoutesPlugin, {
        operationHandlers: createGeneratedOperationHandlers({
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
      assert.deepEqual(response.json(), [graph]);
    },
  );

  await t.test("enforces the current generated POST body schema", async () => {
    const receivedBodies: unknown[] = [];

    server.register(openApiRoutesPlugin, {
      operationHandlers: createGeneratedOperationHandlers({
        createGraph: (request, reply) => {
          receivedBodies.push(request.body);
          reply.code(201);
          return graph;
        },
      }),
    });
    await server.ready();

    const missingBodyResponse = await server.inject({
      method: "POST",
      url: "/v1/graphs",
    });
    const invalidBodyResponse = await server.inject({
      method: "POST",
      url: "/v1/graphs",
      headers: {
        "content-type": "application/json",
      },
      payload: "{}",
    });
    const validBodyResponse = await server.inject({
      method: "POST",
      url: "/v1/graphs",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        federationVersion: "2.5",
        slug: "inventory",
      }),
    });

    assert.equal(missingBodyResponse.statusCode, 400);
    assert.equal(invalidBodyResponse.statusCode, 400);
    assert.equal(validBodyResponse.statusCode, 201);
    assert.deepEqual(receivedBodies, [
      {
        federationVersion: "2.5",
        slug: "inventory",
      },
    ]);
    assert.deepEqual(validBodyResponse.json(), graph);
  });

  await t.test("rejects empty slug values for generated subgraph routes", async () => {
    server.register(openApiRoutesPlugin, {
      operationHandlers: createGeneratedOperationHandlers({
        createSubgraph: (request, reply) => {
          reply.code(201);
          return {
            ...subgraph,
            routingUrl: request.body.routingUrl,
            slug: request.body.slug,
          };
        },
      }),
    });
    await server.ready();

    const invalidBodyResponse = await server.inject({
      method: "POST",
      url: "/v1/graphs/inventory/subgraphs",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        routingUrl: "https://example.com/graphql",
        slug: "",
      }),
    });
    const validBodyResponse = await server.inject({
      method: "POST",
      url: "/v1/graphs/inventory/subgraphs",
      headers: {
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        routingUrl: "https://example.com/graphql",
        slug: "products",
      }),
    });

    assert.equal(invalidBodyResponse.statusCode, 400);
    assert.equal(validBodyResponse.statusCode, 201);
    assert.deepEqual(validBodyResponse.json(), subgraph);
  });
});
