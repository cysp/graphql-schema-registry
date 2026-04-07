export type ActiveGraph = {
  id: string;
  slug: string;
  currentRevision: bigint;
  currentSupergraphSchemaRevision: bigint | null;
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

export type CompositionEligibleSubgraph = {
  subgraphId: string;
  subgraphRevision: bigint;
  subgraphSchemaRevision: bigint;
  subgraphSlug: string;
  routingUrl: string;
  normalizedSdl: string;
};

export type StoredSupergraphSchemaRevision = {
  graphId: string;
  revision: bigint;
  supergraphSdl: string;
  schemaHash: string;
  createdAt: Date;
};
