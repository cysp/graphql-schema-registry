// oxlint-disable eslint-plugin-node/no-process-env

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { authorizationDetailsType } from "./domain/authorization/details.ts";
import { formatStrongETag } from "./domain/etag.ts";
import { createAuthJwtSigner } from "./domain/jwt-signer.ts";
import {
  adminHeaders,
  authorizationHeaders,
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
        scope: "graph:read",
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
        scope: "subgraph-schema:write",
        subgraph_id: subgraphId,
        type: authorizationDetailsType,
      },
    ],
  });
}

async function createGraph(
  fixture: IntegrationFixture,
  adminToken: string,
  slug: string,
): Promise<ReturnType<typeof requireGraphPayload>> {
  const response = await fixture.server.inject({
    headers: adminHeaders(adminToken),
    method: "POST",
    payload: { slug },
    url: "/v1/graphs",
  });
  assert.equal(response.statusCode, 201);
  return requireGraphPayload(parseJson(response));
}

async function createSubgraph(
  fixture: IntegrationFixture,
  adminToken: string,
  graphSlug: string,
  slug: string,
  routingUrl: string,
): Promise<ReturnType<typeof requireSubgraphPayload>> {
  const response = await fixture.server.inject({
    headers: adminHeaders(adminToken),
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

    if (line.startsWith("data:")) {
      const data = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
      dataLines.push(data);
    }
  }

  return {
    data: dataLines.join("\n"),
    id,
  };
}

function createSseReader(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";

  const timeoutError = new Error("Timed out waiting for SSE event.");

  async function readFrame(timeoutMs: number): Promise<string> {
    const timeoutAt = Date.now() + timeoutMs;

    for (;;) {
      const frameDelimiterIndex = buffer.indexOf("\n\n");
      if (frameDelimiterIndex >= 0) {
        const frame = buffer.slice(0, frameDelimiterIndex);
        buffer = buffer.slice(frameDelimiterIndex + 2);
        return frame;
      }

      const remainingMs = timeoutAt - Date.now();
      if (remainingMs <= 0) {
        throw timeoutError;
      }

      const readResult = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(timeoutError);
          }, remainingMs);
        }),
      ]);

      if (readResult.done) {
        throw new Error("SSE stream ended unexpectedly.");
      }

      buffer += decoder.decode(readResult.value, { stream: true });
    }
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

  const jwtSigner = createAuthJwtSigner();
  const adminToken = jwtSigner.createToken({
    authorization_details: [
      {
        scope: "admin",
        type: authorizationDetailsType,
      },
    ],
  });

  await t.test("enforces the same auth outcomes in SSE mode", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification: jwtSigner.jwtVerification,
    });

    try {
      const graph = await createGraph(fixture, adminToken, "catalog");

      const unauthenticated = await fixture.server.inject({
        headers: {
          accept: "text/event-stream",
        },
        method: "GET",
        url: `/v1/graphs/${graph.slug}/supergraph.graphqls`,
      });
      assert.equal(unauthenticated.statusCode, 401);

      const adminUser = await fixture.server.inject({
        headers: {
          ...adminHeaders(adminToken),
          accept: "text/event-stream",
        },
        method: "GET",
        url: `/v1/graphs/${graph.slug}/supergraph.graphqls`,
      });
      assert.equal(adminUser.statusCode, 403);

      const graphReadToken = createGraphReadGrantToken(jwtSigner.createToken, randomUUID());
      const missingGraph = await fixture.server.inject({
        headers: {
          ...authorizationHeaders(graphReadToken),
          accept: "text/event-stream",
        },
        method: "GET",
        url: "/v1/graphs/missing-graph/supergraph.graphqls",
      });
      assert.equal(missingGraph.statusCode, 404);
    } finally {
      await fixture.close();
    }
  });

  await t.test("streams initial snapshot with id matching the non-stream ETag", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification: jwtSigner.jwtVerification,
    });

    let controller: AbortController | undefined;

    try {
      const graph = await createGraph(fixture, adminToken, "catalog");
      const subgraph = await createSubgraph(
        fixture,
        adminToken,
        graph.slug,
        "inventory",
        "https://inventory.example.com/graphql",
      );
      await publishSubgraphSchema(
        fixture,
        jwtSigner.createToken,
        graph,
        subgraph,
        inventorySchemaSdl,
      );

      const graphReadToken = createGraphReadGrantToken(jwtSigner.createToken, graph.id);
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
      jwtVerification: jwtSigner.jwtVerification,
    });

    let controller: AbortController | undefined;

    try {
      const graph = await createGraph(fixture, adminToken, "catalog");
      const subgraph = await createSubgraph(
        fixture,
        adminToken,
        graph.slug,
        "inventory",
        "https://inventory.example.com/graphql",
      );
      const graphReadToken = createGraphReadGrantToken(jwtSigner.createToken, graph.id);

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

      await publishSubgraphSchema(
        fixture,
        jwtSigner.createToken,
        graph,
        subgraph,
        inventorySchemaSdl,
      );

      const event = await sseReader.readDataEvent();
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
      jwtVerification: jwtSigner.jwtVerification,
    });

    let controller: AbortController | undefined;

    try {
      const graph = await createGraph(fixture, adminToken, "catalog");
      const subgraph = await createSubgraph(
        fixture,
        adminToken,
        graph.slug,
        "inventory",
        "https://inventory.example.com/graphql",
      );
      await publishSubgraphSchema(
        fixture,
        jwtSigner.createToken,
        graph,
        subgraph,
        inventorySchemaSdl,
      );

      const graphReadToken = createGraphReadGrantToken(jwtSigner.createToken, graph.id);
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
      assert.equal(event.id, formatStrongETag(graph.id, 1));
    } finally {
      controller?.abort();
      await fixture.close();
    }
  });

  await t.test("waits for updates, supports Last-Event-ID, and ignores failed recomposition", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification: jwtSigner.jwtVerification,
    });

    let controller: AbortController | undefined;

    try {
      const graph = await createGraph(fixture, adminToken, "catalog");
      const inventorySubgraph = await createSubgraph(
        fixture,
        adminToken,
        graph.slug,
        "inventory",
        "https://inventory.example.com/graphql",
      );
      await publishSubgraphSchema(
        fixture,
        jwtSigner.createToken,
        graph,
        inventorySubgraph,
        inventorySchemaSdl,
      );

      const graphReadToken = createGraphReadGrantToken(jwtSigner.createToken, graph.id);
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
        adminToken,
        graph.slug,
        "warehouse",
        "https://warehouse.example.com/graphql",
      );
      await publishSubgraphSchema(
        fixture,
        jwtSigner.createToken,
        graph,
        warehouseSubgraph,
        conflictingProductsSchemaSdl,
      );

      await assert.rejects(async () => sseReader.readDataEvent(400), /Timed out/);
    } finally {
      controller?.abort();
      await fixture.close();
    }
  });

  await t.test("returns 400 for invalid Last-Event-ID values", async () => {
    const fixture = await createIntegrationServerFixture({
      databaseUrl: integrationDatabaseUrl,
      jwtVerification: jwtSigner.jwtVerification,
    });

    try {
      const graph = await createGraph(fixture, adminToken, "catalog");
      const graphReadToken = createGraphReadGrantToken(jwtSigner.createToken, graph.id);

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
