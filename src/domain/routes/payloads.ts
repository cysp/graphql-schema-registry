import type { FastifyReply } from "fastify";

import type { ActiveGraph } from "../database/graph-records.ts";
import type { ActiveSubgraph } from "../database/subgraph-records.ts";
import { formatStrongETag } from "../etag.ts";

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

function setRevisionETag(reply: FastifyReply, resourceId: string, revision: number): void {
  reply.header("ETag", formatStrongETag(resourceId, revision));
}

export function sendGraphResponse(reply: FastifyReply, graph: ActiveGraph): FastifyReply {
  setRevisionETag(reply, graph.id, graph.revision);
  return reply.code(200).send(toGraphPayload(graph));
}

export function sendCreatedGraphResponse(reply: FastifyReply, graph: ActiveGraph): FastifyReply {
  setRevisionETag(reply, graph.id, graph.revision);
  reply.header("Location", `/v1/graphs/${encodeURIComponent(graph.slug)}`);
  return reply.code(201).send(toGraphPayload(graph));
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

export function sendSubgraphResponse(reply: FastifyReply, subgraph: ActiveSubgraph): FastifyReply {
  setRevisionETag(reply, subgraph.id, subgraph.revision);
  return reply.code(200).send(toSubgraphPayload(subgraph));
}

export function sendCreatedSubgraphResponse(
  reply: FastifyReply,
  graphSlug: string,
  subgraph: ActiveSubgraph,
): FastifyReply {
  setRevisionETag(reply, subgraph.id, subgraph.revision);
  reply.header(
    "Location",
    `/v1/graphs/${encodeURIComponent(graphSlug)}/subgraphs/${encodeURIComponent(subgraph.slug)}`,
  );
  return reply.code(201).send(toSubgraphPayload(subgraph));
}
