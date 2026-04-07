export type ActiveGraph = {
  id: string;
  slug: string;
  currentRevision: number;
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
