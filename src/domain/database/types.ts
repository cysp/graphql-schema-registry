export type ActiveGraph = {
  id: string;
  slug: string;
  currentRevision: number;
  currentGraphCompositionRevision: number | null;
  federationVersion: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ActiveSubgraph = {
  graphId: string;
  id: string;
  slug: string;
  currentRevision: number;
  routingUrl: string;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredSubgraphSchemaRevision = {
  subgraphId: string;
  revision: number;
  normalizedHash: string;
  normalizedSdl: string;
  createdAt: Date;
};
export type StoredGraphComposition = {
  graphId: string;
  revision: number;
  supergraphSdl: string;
  compositionHash: string | null;
  createdAt: Date;
};
