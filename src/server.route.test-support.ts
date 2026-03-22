import assert from "node:assert/strict";
import type { OutgoingHttpHeader, OutgoingHttpHeaders } from "node:http";
import type { TestContext } from "node:test";

import type { FastifyInstance } from "fastify";

export type RouteRequest = {
  headers?: Record<string, string>;
  method: "DELETE" | "GET" | "POST" | "PUT";
  payload?: Record<string, string>;
  url: string;
};

type ProblemResponse = {
  body: string;
  headers: OutgoingHttpHeaders;
  statusCode: number;
};

export const jsonHeaders = {
  "content-type": "application/json",
} as const;

export const ifMatchHeaders = {
  "if-match": "*",
} as const;

export function createAuthorizedRequest(request: RouteRequest, token: string): RouteRequest {
  return {
    ...request,
    headers:
      request.headers === undefined
        ? { authorization: `Bearer ${token}` }
        : {
            ...request.headers,
            authorization: `Bearer ${token}`,
          },
  };
}

function requireStringHeader(value: OutgoingHttpHeader | undefined, headerName: string): string {
  if (typeof value !== "string") {
    throw new assert.AssertionError({
      actual: value,
      expected: "string header value",
      message: `Expected ${headerName} header to be a string.`,
      operator: "===",
    });
  }

  return value;
}

export function assertProblemResponse(
  response: ProblemResponse,
  status: number,
  title: string,
): void {
  assert.equal(response.statusCode, status);
  const contentType = requireStringHeader(response.headers["content-type"], "content-type");
  assert.match(contentType, /^application\/problem\+json\b/);
  assert.deepEqual(JSON.parse(response.body) as unknown, {
    type: "about:blank",
    status,
    title,
  });
}

export async function assertProtectedRouteBehavior(
  t: TestContext,
  {
    adminExpectedStatus = 501,
    adminExpectedTitle = "Not Implemented",
    createAdminToken,
    forbiddenDescription,
    forbiddenToken,
    request,
    server,
  }: {
    adminExpectedStatus?: number;
    adminExpectedTitle?: string;
    createAdminToken: () => string;
    forbiddenDescription: string;
    forbiddenToken: string;
    request: RouteRequest;
    server: FastifyInstance;
  },
): Promise<void> {
  await t.test("returns 401 without auth", async () => {
    const response = await server.inject(request);

    assertProblemResponse(response, 401, "Unauthorized");
    assert.equal(response.headers["www-authenticate"], "Bearer");
  });

  await t.test(`returns 403 for ${forbiddenDescription}`, async () => {
    const response = await server.inject(createAuthorizedRequest(request, forbiddenToken));

    assertProblemResponse(response, 403, "Forbidden");
    assert.equal(response.headers["www-authenticate"], undefined);
  });

  await t.test(`returns ${String(adminExpectedStatus)} for admin users`, async () => {
    const response = await server.inject(createAuthorizedRequest(request, createAdminToken()));

    assertProblemResponse(response, adminExpectedStatus, adminExpectedTitle);
    assert.equal(response.headers["www-authenticate"], undefined);
  });
}
