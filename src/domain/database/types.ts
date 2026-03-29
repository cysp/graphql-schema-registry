export type ActiveGraph = {
  id: string;
  slug: string;
  currentRevision: number;
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
