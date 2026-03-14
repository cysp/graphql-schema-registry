import assert from "node:assert/strict";
import type { OutgoingHttpHeader, OutgoingHttpHeaders } from "node:http";

import type { OpenApiOperationHandlers } from "./plugin.ts";

export type JsonResponse = {
  headers: OutgoingHttpHeaders;
  json(): unknown;
  statusCode: number;
};

export const graph = {
  createdAt: "2026-03-11T00:00:00.000Z",
  federationVersion: "2.5",
  id: "00000000-0000-4000-8000-000000000001",
  revisionId: "1",
  slug: "inventory",
  updatedAt: "2026-03-11T00:00:00.000Z",
};

export const subgraph = {
  createdAt: "2026-03-11T00:00:00.000Z",
  graphId: "00000000-0000-4000-8000-000000000001",
  id: "00000000-0000-4000-8000-000000000002",
  revisionId: "1",
  routingUrl: "https://example.com/graphql",
  slug: "products",
  updatedAt: "2026-03-11T00:00:00.000Z",
};

export const badRequestProblem = {
  type: "about:blank",
  status: 400,
  title: "Bad Request",
};

export const jsonHeaders = {
  "content-type": "application/json",
};

export const ifMatchHeaders = {
  "if-match": "*",
};

export const createGraphBody = {
  federationVersion: "2.5",
  slug: "inventory",
};

export const updateGraphBody = {
  federationVersion: "2.5",
};

export const createSubgraphBody = {
  routingUrl: "https://example.com/graphql",
  slug: "products",
};

export const updateSubgraphBody = {
  routingUrl: "https://example.com/updated-graphql",
};

const unexpectedOperationHandler = () => {
  throw new Error("Unexpected handler call.");
};

export function defaultedOperationHandlers(
  overrides: Partial<OpenApiOperationHandlers> = {},
): OpenApiOperationHandlers {
  return {
    createGraph: unexpectedOperationHandler,
    createSubgraph: unexpectedOperationHandler,
    deleteGraph: unexpectedOperationHandler,
    deleteSubgraph: unexpectedOperationHandler,
    getGraph: unexpectedOperationHandler,
    getSubgraph: unexpectedOperationHandler,
    listGraphs: unexpectedOperationHandler,
    listSubgraphs: unexpectedOperationHandler,
    updateGraph: unexpectedOperationHandler,
    updateSubgraph: unexpectedOperationHandler,
    ...overrides,
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

export function assertBadRequest(response: JsonResponse): void {
  assert.equal(response.statusCode, 400);
  const contentType = requireStringHeader(response.headers["content-type"], "content-type");
  assert.match(contentType, /^application\/problem\+json\b/);

  assert.deepEqual(response.json(), badRequestProblem);
}

export function assertJsonContentType(response: { headers: OutgoingHttpHeaders }): void {
  const contentType = requireStringHeader(response.headers["content-type"], "content-type");
  assert.match(contentType, /^application\/json\b/);
}
