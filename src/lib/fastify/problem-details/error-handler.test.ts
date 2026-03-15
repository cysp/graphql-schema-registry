import assert from "node:assert/strict";
import type { OutgoingHttpHeaders } from "node:http";
import test from "node:test";

import fastify, { type FastifyInstance } from "fastify";

import { problemDetailsErrorHandler } from "./error-handler.ts";
import { problemDetailsPlugin } from "./plugin.ts";

const problemDetailsContentType = "application/problem+json; charset=utf-8";

function createServer(): FastifyInstance {
  const server = fastify();
  server.register(problemDetailsPlugin);
  server.setErrorHandler(problemDetailsErrorHandler);
  return server;
}

function createProblemError(
  message: string,
  properties: Record<string, unknown> = {},
): Error & Record<string, unknown> {
  return Object.assign(new Error(message), properties);
}

function assertProblemDetails(
  response: {
    headers: OutgoingHttpHeaders;
    json(): unknown;
    statusCode: number;
  },
  status: number,
  title: string,
): void {
  assert.equal(response.statusCode, status);
  assert.equal(response.headers["content-type"], problemDetailsContentType);
  assert.deepEqual(response.json(), {
    type: "about:blank",
    status,
    title,
  });
}

await test("problemDetailsErrorHandler", async (t) => {
  let server: FastifyInstance;

  t.beforeEach(() => {
    server = createServer();
  });

  t.afterEach(async () => {
    await server.close();
  });

  await t.test("returns problem details for validation failures", async () => {
    server.post(
      "/widgets",
      {
        schema: {
          body: {
            additionalProperties: false,
            properties: {
              name: {
                type: "string",
              },
            },
            required: ["name"],
            type: "object",
          },
        },
      },
      async () => {
        throw new Error("Unexpected handler call.");
      },
    );

    await server.ready();

    const response = await server.inject({
      method: "POST",
      url: "/widgets",
      headers: {
        "content-type": "application/json",
      },
      payload: "{}",
    });

    assertProblemDetails(response, 400, "Bad Request");
  });

  await t.test("prefers the thrown error status and forwards valid headers", async () => {
    server.get("/auth", async () => {
      throw createProblemError("Authentication required.", {
        status: 401,
        statusCode: 503,
        headers: {
          "www-authenticate": "Bearer",
        },
      });
    });

    await server.ready();

    const response = await server.inject({
      method: "GET",
      url: "/auth",
    });

    assert.equal(response.headers["www-authenticate"], "Bearer");
    assertProblemDetails(response, 401, "Unauthorized");
  });

  await t.test("falls back to 500 when error metadata is invalid", async () => {
    server.get("/invalid-error-metadata", async () => {
      throw createProblemError("Authentication required.", {
        statusCode: 401.5,
        headers: ["Bearer"],
      });
    });

    await server.ready();

    const response = await server.inject({
      method: "GET",
      url: "/invalid-error-metadata",
    });

    assert.equal(response.headers["0"], undefined);
    assertProblemDetails(response, 500, "Internal Server Error");
  });

  await t.test(
    "uses the existing reply status when the thrown error has no valid status",
    async () => {
      server.get("/conflict", async (_request, reply) => {
        reply.code(409);
        throw createProblemError("");
      });

      await server.ready();

      const response = await server.inject({
        method: "GET",
        url: "/conflict",
      });

      assertProblemDetails(response, 409, "Conflict");
    },
  );
});
