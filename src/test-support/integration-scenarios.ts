import assert from "node:assert/strict";

import { authorizationDetailsType } from "../domain/authorization/details.ts";
import type { createAuthJwtSigner } from "../domain/jwt-signer.ts";
import {
  authorizationHeaders,
  parseJson,
  type IntegrationServerFixture,
} from "./integration-server.ts";
import {
  requireGraphPayload,
  requireSubgraphPayload,
  type GraphPayload,
  type SubgraphPayload,
} from "./payloads.ts";

type CreateToken = ReturnType<typeof createAuthJwtSigner>["createToken"];
type SchemaWriteRequestOptions = {
  ifMatch?: string | undefined;
};

export function createSupergraphSchemaReadGrantToken(
  createToken: CreateToken,
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

export function createWildcardSupergraphSchemaReadGrantToken(createToken: CreateToken): string {
  return createToken({
    authorization_details: [
      {
        graph_id: "*",
        scope: "supergraph_schema:read",
        type: authorizationDetailsType,
      },
    ],
  });
}

export function createSubgraphSchemaGrantToken(
  createToken: CreateToken,
  scope: "subgraph_schema:read" | "subgraph_schema:write",
  graphId: string,
  subgraphId: string,
): string {
  return createToken({
    authorization_details: [
      {
        graph_id: graphId,
        scope,
        subgraph_id: subgraphId,
        type: authorizationDetailsType,
      },
    ],
  });
}

export function createWildcardSubgraphSchemaGrantToken(
  createToken: CreateToken,
  scope: "subgraph_schema:read" | "subgraph_schema:write",
): string {
  return createToken({
    authorization_details: [
      {
        graph_id: "*",
        scope,
        subgraph_id: "*",
        type: authorizationDetailsType,
      },
    ],
  });
}

export async function createGraph(
  fixture: IntegrationServerFixture,
  graphManageToken: string,
  slug: string,
): Promise<GraphPayload> {
  const response = await fixture.server.inject({
    headers: authorizationHeaders(graphManageToken),
    method: "POST",
    payload: { slug },
    url: "/v1/graphs",
  });
  assert.equal(response.statusCode, 201);
  return requireGraphPayload(parseJson(response));
}

export async function createSubgraph(
  fixture: IntegrationServerFixture,
  graphManageToken: string,
  graphSlug: string,
  slug: string,
  routingUrl: string,
): Promise<SubgraphPayload> {
  const encodedGraphSlug = encodeURIComponent(graphSlug);
  const response = await fixture.server.inject({
    headers: authorizationHeaders(graphManageToken),
    method: "POST",
    payload: { routingUrl, slug },
    url: `/v1/graphs/${encodedGraphSlug}/subgraphs`,
  });
  assert.equal(response.statusCode, 201);
  return requireSubgraphPayload(parseJson(response));
}

export async function publishSubgraphSchema(
  fixture: IntegrationServerFixture,
  createToken: CreateToken,
  graph: GraphPayload,
  subgraph: SubgraphPayload,
  schemaSdl: string,
  options?: SchemaWriteRequestOptions,
): Promise<string | undefined> {
  const schemaWriteToken = createSubgraphSchemaGrantToken(
    createToken,
    "subgraph_schema:write",
    graph.id,
    subgraph.id,
  );

  const headers: Record<string, string> = {
    ...authorizationHeaders(schemaWriteToken),
    "content-type": "text/plain",
  };
  if (options?.ifMatch) {
    headers["if-match"] = options.ifMatch;
  }
  const encodedGraphSlug = encodeURIComponent(graph.slug);
  const encodedSubgraphSlug = encodeURIComponent(subgraph.slug);

  const response = await fixture.server.inject({
    headers,
    method: "POST",
    payload: schemaSdl,
    url: `/v1/graphs/${encodedGraphSlug}/subgraphs/${encodedSubgraphSlug}/schema.graphqls`,
  });
  assert.equal(response.statusCode, 204);

  const etag = response.headers.etag;
  return typeof etag === "string" ? etag : undefined;
}

export async function deleteSubgraphSchema(
  fixture: IntegrationServerFixture,
  createToken: CreateToken,
  graph: GraphPayload,
  subgraph: SubgraphPayload,
  options?: SchemaWriteRequestOptions,
): Promise<void> {
  const schemaWriteToken = createSubgraphSchemaGrantToken(
    createToken,
    "subgraph_schema:write",
    graph.id,
    subgraph.id,
  );

  const headers: Record<string, string> = authorizationHeaders(schemaWriteToken);
  if (options?.ifMatch) {
    headers["if-match"] = options.ifMatch;
  }
  const encodedGraphSlug = encodeURIComponent(graph.slug);
  const encodedSubgraphSlug = encodeURIComponent(subgraph.slug);

  const response = await fixture.server.inject({
    headers,
    method: "DELETE",
    url: `/v1/graphs/${encodedGraphSlug}/subgraphs/${encodedSubgraphSlug}/schema.graphqls`,
  });
  assert.equal(response.statusCode, 204);
}

export async function updateSubgraphRoutingUrl(
  fixture: IntegrationServerFixture,
  graphManageToken: string,
  graphSlug: string,
  subgraphSlug: string,
  routingUrl: string,
): Promise<void> {
  const encodedGraphSlug = encodeURIComponent(graphSlug);
  const encodedSubgraphSlug = encodeURIComponent(subgraphSlug);
  const response = await fixture.server.inject({
    headers: authorizationHeaders(graphManageToken),
    method: "PUT",
    payload: { routingUrl },
    url: `/v1/graphs/${encodedGraphSlug}/subgraphs/${encodedSubgraphSlug}`,
  });
  assert.equal(response.statusCode, 200);
}

export async function deleteSubgraph(
  fixture: IntegrationServerFixture,
  graphManageToken: string,
  graphSlug: string,
  subgraphSlug: string,
): Promise<void> {
  const encodedGraphSlug = encodeURIComponent(graphSlug);
  const encodedSubgraphSlug = encodeURIComponent(subgraphSlug);
  const response = await fixture.server.inject({
    headers: authorizationHeaders(graphManageToken),
    method: "DELETE",
    url: `/v1/graphs/${encodedGraphSlug}/subgraphs/${encodedSubgraphSlug}`,
  });
  assert.equal(response.statusCode, 204);
}
