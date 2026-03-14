// oxlint-disable typescript-eslint/no-deprecated,eslint/no-use-before-define

import { defineRelations } from "drizzle-orm/relations";

import * as schema from "./schema.ts";

export const relations = defineRelations(schema, (r) => ({
  graphs: {
    currentRevision: r.one.graphRevisions({
      from: [r.graphs.id, r.graphs.currentRevisionId],
      to: [r.graphRevisions.graphId, r.graphRevisions.revisionId],
      optional: true,
    }),
    revisions: r.many.graphRevisions({
      from: r.graphs.id,
      to: r.graphRevisions.graphId,
    }),
    subgraphs: r.many.subgraphs({
      from: r.graphs.id,
      to: r.subgraphs.graphId,
    }),
  },
  graphRevisions: {
    graph: r.one.graphs({
      from: r.graphRevisions.graphId,
      to: r.graphs.id,
      optional: false,
    }),
  },
  subgraphs: {
    currentRevision: r.one.subgraphRevisions({
      from: [r.subgraphs.id, r.subgraphs.currentRevisionId],
      to: [r.subgraphRevisions.subgraphId, r.subgraphRevisions.revisionId],
      optional: true,
    }),
    graph: r.one.graphs({
      from: r.subgraphs.graphId,
      to: r.graphs.id,
      optional: false,
    }),
    revisions: r.many.subgraphRevisions({
      from: r.subgraphs.id,
      to: r.subgraphRevisions.subgraphId,
    }),
  },
  subgraphRevisions: {
    subgraph: r.one.subgraphs({
      from: r.subgraphRevisions.subgraphId,
      to: r.subgraphs.id,
      optional: false,
    }),
  },
}));
