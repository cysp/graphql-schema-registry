export type ActiveGraph = {
  id: string;
  slug: string;
  revision: number;
  federationVersion: string;
  currentCompositionRevision: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ActiveSubgraph = {
  graphId: string;
  id: string;
  slug: string;
  revision: number;
  routingUrl: string;
  createdAt: Date;
  updatedAt: Date;
};
