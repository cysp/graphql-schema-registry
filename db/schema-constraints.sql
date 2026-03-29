ALTER TABLE "graphs"
  ADD CONSTRAINT "graphs_current_revision_fkey"
  FOREIGN KEY ("id", "current_revision")
  REFERENCES "graph_revisions"("graph_id", "revision")
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "subgraphs"
  ADD CONSTRAINT "subgraphs_current_revision_fkey"
  FOREIGN KEY ("id", "current_revision")
  REFERENCES "subgraph_revisions"("subgraph_id", "revision")
  DEFERRABLE INITIALLY DEFERRED;
