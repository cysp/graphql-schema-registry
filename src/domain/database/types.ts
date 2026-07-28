export type ActiveGraph = {
  id: string;
  slug: string;
  currentRevision: bigint;
  currentCompositionRevision: bigint | null;
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
  normalizedSdlSha256: Buffer;
  normalizedSdl: string;
  createdAt: Date;
};

export type GraphCompositionEligibleSubgraph = {
  subgraphId: string;
  slug: string;
  subgraphRevision: bigint;
  routingUrl: string;
  subgraphSchemaRevision: bigint;
  normalizedSdl: string;
};

export type GraphCompositionServiceDefinition = {
  subgraphId: string;
  slug: string;
  routingUrl: string;
  normalizedSdl: string;
};

export type GraphCompositionSubgraphReference = {
  subgraphId: string;
  subgraphRevision: bigint;
  subgraphSchemaRevision: bigint;
};

export type StoredGraphCompositionAttempt = {
  graphId: string;
  revision: bigint;
  createdAt: Date;
};

export type StoredSupergraphSchema = {
  graphId: string;
  compositionRevision: bigint;
  supergraphSdlSha256: Buffer;
  supergraphSdl: string;
  createdAt: Date;
};
