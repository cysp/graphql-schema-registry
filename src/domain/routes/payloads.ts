import type { ActiveGraph, ActiveSubgraph } from "../database/types.ts";

export type GraphPayload = {
  id: string;
  slug: string;
  revision: string;
  federationVersion: string;
  createdAt: string;
  updatedAt: string;
};

export type SubgraphPayload = {
  id: string;
  graphId: string;
  slug: string;
  revision: string;
  routingUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type PublishSubgraphSchemaPayload = {
  revision: string;
};

export function toGraphPayload(graph: ActiveGraph): GraphPayload {
  return {
    id: graph.id,
    slug: graph.slug,
    revision: String(graph.revision),
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
    revision: String(subgraph.revision),
    routingUrl: subgraph.routingUrl,
    createdAt: subgraph.createdAt.toISOString(),
    updatedAt: subgraph.updatedAt.toISOString(),
  };
}
