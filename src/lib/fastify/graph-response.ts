export type PersistedGraph = {
  createdAt: Date;
  externalId: string;
  federationVersion: string;
  id: number;
  revisionId: number;
  slug: string;
  updatedAt: Date;
};

export type GraphResponsePayload = {
  createdAt: string;
  federationVersion: string;
  id: string;
  revisionId: string;
  slug: string;
  updatedAt: string;
};

export function toGraphResponse(graph: PersistedGraph): GraphResponsePayload {
  return {
    id: graph.externalId,
    slug: graph.slug,
    revisionId: String(graph.revisionId),
    federationVersion: graph.federationVersion,
    createdAt: graph.createdAt.toISOString(),
    updatedAt: graph.updatedAt.toISOString(),
  };
}
