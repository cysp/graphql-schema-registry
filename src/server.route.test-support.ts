import assert from "node:assert/strict";
import type { OutgoingHttpHeader, OutgoingHttpHeaders } from "node:http";

export type RouteRequest = {
  headers?: Record<string, string>;
  method: "DELETE" | "GET" | "POST" | "PUT";
  payload?: Record<string, string> | string;
  url: string;
};

type ProblemResponse = {
  body: string;
  headers: OutgoingHttpHeaders;
  statusCode: number;
};

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
