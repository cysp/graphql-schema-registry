ALTER TABLE "graphs"
  ADD CONSTRAINT "graphs_revision_fkey"
  FOREIGN KEY ("id", "revision")
  REFERENCES "graph_revisions"("graph_id", "revision")
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "subgraphs"
  ADD CONSTRAINT "subgraphs_revision_fkey"
  FOREIGN KEY ("id", "revision")
  REFERENCES "subgraph_revisions"("subgraph_id", "revision")
  DEFERRABLE INITIALLY DEFERRED;
