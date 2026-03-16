import assert from "node:assert/strict";
import type { OutgoingHttpHeaders } from "node:http";
import test from "node:test";

import fastify, { type FastifyInstance } from "fastify";

import { problemDetailsPlugin } from "./plugin.ts";

const problemDetailsContentType = "application/problem+json; charset=utf-8";

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

await test("problemDetailsPlugin", async (t) => {
  let server: FastifyInstance;

  t.beforeEach(() => {
    server = fastify();
    server.register(problemDetailsPlugin);
  });

  t.afterEach(async () => {
    await server.close();
  });

  await t.test("returns the default problem details payload and forwards headers", async () => {
    server.get("/unauthorized", async (_, reply) => {
      return reply.problemDetails({
        status: 401,
        headers: {
          "www-authenticate": "Bearer",
        },
      });
    });
    await server.ready();

    const response = await server.inject({
      method: "GET",
      url: "/unauthorized",
    });

    assert.equal(response.headers["www-authenticate"], "Bearer");
    assertProblemDetails(response, 401, "Unauthorized");
  });

  await t.test("uses explicit titles", async () => {
    server.get("/too-many-requests", async (_, reply) => {
      return reply.problemDetails({
        status: 429,
        title: "Too Many Requests",
      });
    });
    await server.ready();

    const response = await server.inject({
      method: "GET",
      url: "/too-many-requests",
    });

    assertProblemDetails(response, 429, "Too Many Requests");
  });
});
