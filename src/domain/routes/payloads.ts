import type { ActiveGraph, ActiveSubgraph } from "../database/types.ts";

export type GraphPayload = {
  id: string;
  slug: string;
  currentRevision: string;
  federationVersion: string;
  createdAt: string;
  updatedAt: string;
};

export type SubgraphPayload = {
  id: string;
  graphId: string;
  slug: string;
  currentRevision: string;
  routingUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type PublishSubgraphSchemaPayload = {
  currentRevision: string;
};

export function toGraphPayload(graph: ActiveGraph): GraphPayload {
  return {
    id: graph.id,
    slug: graph.slug,
    currentRevision: String(graph.currentRevision),
    federationVersion: graph.federationVersion,
    createdAt: graph.createdAt.toISOString(),
    updatedAt: graph.updatedAt.toISOString(),
  };
}

export function toSubgraphPayload(subgraph: ActiveSubgraph): SubgraphPayload {
  return {
    id: subgraph.id,
    graphId: subgraph.graphId,
    slug: subgraph.slug,
    currentRevision: String(subgraph.currentRevision),
    routingUrl: subgraph.routingUrl,
    createdAt: subgraph.createdAt.toISOString(),
    updatedAt: subgraph.updatedAt.toISOString(),
  };
}
