export type ActiveGraph = {
  id: string;
  slug: string;
  currentRevision: bigint;
  createdAt: Date;
  updatedAt: Date;
};

export type ActiveSubgraph = {
  graphId: string;
  id: string;
  slug: string;
  currentRevision: bigint;
  routingUrl: string;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredSubgraphSchemaRevision = {
  subgraphId: string;
  revision: bigint;
  normalizedHash: string;
  normalizedSdl: string;
  createdAt: Date;
};
