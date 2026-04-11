// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { formatStrongETag } from "./domain/etag.ts";
import type { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import {
  authorizationHeaders,
  createGraphManageIntegrationAuth,
  createIntegrationServerFixture,
  parseJson,
} from "./test-support/integration-server.ts";
import { requireGraphPayload, requireSubgraphPayload } from "./test-support/payloads.ts";

const inventorySchemaSdl = `
  type Query {
    products: [String!]!
  }
`;

const conflictingProductsSchemaSdl = `
  type Query {
    products: [Int!]!
  }
`;

type IntegrationFixture = Awaited<ReturnType<typeof createIntegrationServerFixture>>;

type SseEvent = {
  data: string;
  event: string | undefined;
  id: string | undefined;
};

function createGraphReadGrantToken(
  createToken: ReturnType<typeof createAuthJwtSigner>["createToken"],
  graphId: string,
): string {
  return createToken({
    authorization_details: [
      {
        graph_id: graphId,
        scope: "supergraph_schema:read",
        type: authorizationDetailsType,
      },
    ],
  });
}

function createSubgraphSchemaGrantToken(
  createToken: ReturnType<typeof createAuthJwtSigner>["createToken"],
  graphId: string,
  subgraphId: string,
): string {
  return createToken({
    authorization_details: [
      {
        graph_id: graphId,
        scope: "subgraph_schema:write",
        subgraph_id: subgraphId,
        type: authorizationDetailsType,
      },
    ],
  });
}

async function createGraph(
  fixture: IntegrationFixture,
  graphManageToken: string,
  slug: string,
): Promise<ReturnType<typeof requireGraphPayload>> {
  const response = await fixture.server.inject({
    headers: authorizationHeaders(graphManageToken),
    method: "POST",
    payload: { slug },
    url: "/v1/graphs",
  });
  assert.equal(response.statusCode, 201);
  return requireGraphPayload(parseJson(response));
}

async function createSubgraph(
  fixture: IntegrationFixture,
  graphManageToken: string,
  graphSlug: string,
  slug: string,
  routingUrl: string,
): Promise<ReturnType<typeof requireSubgraphPayload>> {
  const response = await fixture.server.inject({
    headers: authorizationHeaders(graphManageToken),
    method: "POST",
    payload: { routingUrl, slug },
    url: `/v1/graphs/${graphSlug}/subgraphs`,
  });
  assert.equal(response.statusCode, 201);
  return requireSubgraphPayload(parseJson(response));
}

async function publishSubgraphSchema(
  fixture: IntegrationFixture,
  createToken: ReturnType<typeof createAuthJwtSigner>["createToken"],
  graph: ReturnType<typeof requireGraphPayload>,
  subgraph: ReturnType<typeof requireSubgraphPayload>,
  schemaSdl: string,
): Promise<void> {
  const schemaWriteToken = createSubgraphSchemaGrantToken(createToken, graph.id, subgraph.id);
  const response = await fixture.server.inject({
    headers: {
      ...authorizationHeaders(schemaWriteToken),
      "content-type": "text/plain",
    },
    method: "POST",
    payload: schemaSdl,
    url: `/v1/graphs/${graph.slug}/subgraphs/${subgraph.slug}/schema.graphqls`,
  });
  assert.equal(response.statusCode, 204);
}

function parseSseFrame(frame: string): SseEvent {
  let event: string | undefined;
  let id: string | undefined;
  const dataLines: string[] = [];

  for (const line of frame.split(/\r?\n/u)) {
    if (line === "" || line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("id:")) {
      id = line.slice(3).trimStart();
      continue;
    }

    if (line.startsWith("event:")) {
      event = line.slice(6).trimStart();
      continue;
    }

    if (line.startsWith("data:")) {
      const data = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
      dataLines.push(data);
    }
  }

  return {
    data: dataLines.join("\n"),
    event,
    id,
  };
}

function createSseReader(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";
  const frames: string[] = [];
  const waiters = new Set<() => void>();
  let streamError: Error | undefined;

  const timeoutError = new Error("Timed out waiting for SSE event.");

  const notifyWaiters = (): void => {
    for (const waiter of waiters) {
      waiter();
    }
  };

  // Keep a single outstanding read so timed-out callers do not accidentally consume later frames.
  // oxlint-disable-next-line eslint(no-void)
  void (async () => {
    try {
      for (;;) {
        const readResult = await reader.read();
        if (readResult.done) {
          streamError = new Error("SSE stream ended unexpectedly.");
          notifyWaiters();
          return;
        }

        buffer += decoder.decode(readResult.value, { stream: true });

        for (;;) {
          const frameDelimiterIndex = buffer.indexOf("\n\n");
          if (frameDelimiterIndex < 0) {
            break;
          }

          frames.push(buffer.slice(0, frameDelimiterIndex));
          buffer = buffer.slice(frameDelimiterIndex + 2);
        }

        notifyWaiters();
      }
    } catch (error) {
      streamError = error instanceof Error ? error : new Error(String(error));
      notifyWaiters();
    }
  })();

  async function readFrame(timeoutMs: number): Promise<string> {
    if (frames.length > 0) {
      return frames.shift() ?? "";
    }

    if (streamError) {
      throw new Error(streamError.message, { cause: streamError });
    }

    return new Promise<string>((resolve, reject) => {
      let onReady: () => void;
      let timeoutHandle: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        waiters.delete(onReady);
      };

      onReady = () => {
        if (frames.length > 0) {
          cleanup();
          resolve(frames.shift() ?? "");
          return;
        }

        if (streamError) {
          cleanup();
          reject(streamError);
        }
      };

      timeoutHandle = setTimeout(() => {
        cleanup();
        reject(timeoutError);
      }, timeoutMs);

      waiters.add(onReady);
    });
  }

  return {
    async readDataEvent(timeoutMs = 3_000): Promise<SseEvent> {
      const timeoutAt = Date.now() + timeoutMs;

      for (;;) {
        const remainingMs = timeoutAt - Date.now();
        if (remainingMs <= 0) {
          throw timeoutError;
        }

        const frame = await readFrame(remainingMs);
        const parsed = parseSseFrame(frame);
        if (parsed.id !== undefined || parsed.data !== "") {
          return parsed;
        }
      }
    },
  };
}

await test("supergraph schema SSE stream integration with postgres", async (t) => {
  const integrationDatabaseUrl = process.env["INTEGRATION_TEST_DATABASE_URL"]?.trim();
  if (!integrationDatabaseUrl) {
    t.skip("INTEGRATION_TEST_DATABASE_URL is not configured");
    return;
  }

  const { createToken, graphManageToken, jwtVerification } = createGraphManageIntegrationAuth();

  await t.test("enforces the same auth outcomes in SSE mode", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification,
    });

    try {
      const graph = await createGraph(fixture, graphManageToken, "catalog");

      const unauthenticated = await fixture.server.inject({
        headers: {
          accept: "text/event-stream",
        },
        method: "GET",
        url: `/v1/graphs/${graph.slug}/supergraph.graphqls`,
      });
      assert.equal(unauthenticated.statusCode, 401);

      const graphManageUser = await fixture.server.inject({
        headers: {
          ...authorizationHeaders(graphManageToken),
          accept: "text/event-stream",
        },
        method: "GET",
        url: `/v1/graphs/${graph.slug}/supergraph.graphqls`,
      });
      assert.equal(graphManageUser.statusCode, 403);

      const graphReadToken = createGraphReadGrantToken(createToken, randomUUID());
      const missingGraph = await fixture.server.inject({
        headers: {
          ...authorizationHeaders(graphReadToken),
          accept: "text/event-stream",
        },
        method: "GET",
        url: "/v1/graphs/missing-graph/supergraph.graphqls",
      });
      assert.equal(missingGraph.statusCode, 403);
    } finally {
      await fixture.close();
    }
  });

  await t.test("streams initial snapshot with id matching the non-stream ETag", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification,
    });

    let controller: AbortController | undefined;

    try {
      const graph = await createGraph(fixture, graphManageToken, "catalog");
      const subgraph = await createSubgraph(
        fixture,
        graphManageToken,
        graph.slug,
        "inventory",
        "https://inventory.example.com/graphql",
      );
      await publishSubgraphSchema(fixture, createToken, graph, subgraph, inventorySchemaSdl);

      const graphReadToken = createGraphReadGrantToken(createToken, graph.id);
      const address = await fixture.server.listen({ host: "127.0.0.1", port: 0 });
      const streamUrl = `${address}/v1/graphs/${graph.slug}/supergraph.graphqls`;

      controller = new AbortController();
      const response = await fetch(streamUrl, {
        headers: {
          ...authorizationHeaders(graphReadToken),
          accept: "text/event-stream",
        },
        signal: controller.signal,
      });

      assert.equal(response.status, 200);
      assert.ok(response.headers.get("content-type")?.startsWith("text/event-stream"));
      assert.ok(response.body);

      const sseReader = createSseReader(response.body);
      const event = await sseReader.readDataEvent();

      assert.equal(event.event, "schema");
      assert.equal(event.id, formatStrongETag(graph.id, 1));
      assert.match(event.data, /join__Graph/);
      assert.match(event.data, /inventory\.example\.com\/graphql/);
    } finally {
      controller?.abort();
      await fixture.close();
    }
  });

  await t.test("keeps stream open without current schema and emits on first success", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification,
    });

    let controller: AbortController | undefined;

    try {
      const graph = await createGraph(fixture, graphManageToken, "catalog");
      const subgraph = await createSubgraph(
        fixture,
        graphManageToken,
        graph.slug,
        "inventory",
        "https://inventory.example.com/graphql",
      );
      const graphReadToken = createGraphReadGrantToken(createToken, graph.id);

      const address = await fixture.server.listen({ host: "127.0.0.1", port: 0 });
      const streamUrl = `${address}/v1/graphs/${graph.slug}/supergraph.graphqls`;

      controller = new AbortController();
      const response = await fetch(streamUrl, {
        headers: {
          ...authorizationHeaders(graphReadToken),
          accept: "text/event-stream",
        },
        signal: controller.signal,
      });

      assert.equal(response.status, 200);
      assert.ok(response.body);
      const sseReader = createSseReader(response.body);

      await assert.rejects(async () => sseReader.readDataEvent(400), /Timed out/);

      await publishSubgraphSchema(fixture, createToken, graph, subgraph, inventorySchemaSdl);

      const event = await sseReader.readDataEvent();
      assert.equal(event.event, "schema");
      assert.equal(event.id, formatStrongETag(graph.id, 1));
      assert.match(event.data, /join__Graph/);
    } finally {
      controller?.abort();
      await fixture.close();
    }
  });

  await t.test("sends latest snapshot immediately for stale Last-Event-ID", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification,
    });

    let controller: AbortController | undefined;

    try {
      const graph = await createGraph(fixture, graphManageToken, "catalog");
      const subgraph = await createSubgraph(
        fixture,
        graphManageToken,
        graph.slug,
        "inventory",
        "https://inventory.example.com/graphql",
      );
      await publishSubgraphSchema(fixture, createToken, graph, subgraph, inventorySchemaSdl);

      const graphReadToken = createGraphReadGrantToken(createToken, graph.id);
      const address = await fixture.server.listen({ host: "127.0.0.1", port: 0 });
      const streamUrl = `${address}/v1/graphs/${graph.slug}/supergraph.graphqls`;

      controller = new AbortController();
      const response = await fetch(streamUrl, {
        headers: {
          ...authorizationHeaders(graphReadToken),
          accept: "text/event-stream",
          "last-event-id": formatStrongETag(graph.id, 0),
        },
        signal: controller.signal,
      });

      assert.equal(response.status, 200);
      assert.ok(response.body);
      const sseReader = createSseReader(response.body);

      const event = await sseReader.readDataEvent();
      assert.equal(event.event, "schema");
      assert.equal(event.id, formatStrongETag(graph.id, 1));
    } finally {
      controller?.abort();
      await fixture.close();
    }
  });

  await t.test(
    "waits for updates, supports Last-Event-ID, and ignores failed recomposition",
    async () => {
      const fixture = await createIntegrationServerFixture({
        databaseUrl: integrationDatabaseUrl,
        jwtVerification,
      });

      let controller: AbortController | undefined;

      try {
        const graph = await createGraph(fixture, graphManageToken, "catalog");
        const inventorySubgraph = await createSubgraph(
          fixture,
          graphManageToken,
          graph.slug,
          "inventory",
          "https://inventory.example.com/graphql",
        );
        await publishSubgraphSchema(
          fixture,
          createToken,
          graph,
          inventorySubgraph,
          inventorySchemaSdl,
        );

        const graphReadToken = createGraphReadGrantToken(createToken, graph.id);
        const address = await fixture.server.listen({ host: "127.0.0.1", port: 0 });
        const streamUrl = `${address}/v1/graphs/${graph.slug}/supergraph.graphqls`;

        controller = new AbortController();
        const response = await fetch(streamUrl, {
          headers: {
            ...authorizationHeaders(graphReadToken),
            accept: "text/event-stream",
            "last-event-id": formatStrongETag(graph.id, 1),
          },
          signal: controller.signal,
        });

        assert.equal(response.status, 200);
        assert.ok(response.body);
        const sseReader = createSseReader(response.body);

        await assert.rejects(async () => sseReader.readDataEvent(400), /Timed out/);

        const warehouseSubgraph = await createSubgraph(
          fixture,
          graphManageToken,
          graph.slug,
          "warehouse",
          "https://warehouse.example.com/graphql",
        );
        await publishSubgraphSchema(
          fixture,
          createToken,
          graph,
          warehouseSubgraph,
          conflictingProductsSchemaSdl,
        );

        await assert.rejects(async () => sseReader.readDataEvent(400), /Timed out/);
      } finally {
        controller?.abort();
        await fixture.close();
      }
    },
  );

  await t.test("returns 400 for invalid Last-Event-ID values", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification,
    });

    try {
      const graph = await createGraph(fixture, graphManageToken, "catalog");
      const graphReadToken = createGraphReadGrantToken(createToken, graph.id);

      const response = await fixture.server.inject({
        headers: {
          ...authorizationHeaders(graphReadToken),
          accept: "text/event-stream",
          "last-event-id": "not-an-etag",
        },
        method: "GET",
        url: `/v1/graphs/${graph.slug}/supergraph.graphqls`,
      });

      assert.equal(response.statusCode, 400);
    } finally {
      await fixture.close();
    }
  });
});
