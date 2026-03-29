ALTER TABLE "graphs"
  ADD CONSTRAINT "graphs_revision_fkey"
  FOREIGN KEY ("id", "revision")
  REFERENCES "graph_revisions"("graph_id", "revision")
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "graphs"
  ADD CONSTRAINT "graphs_current_composition_revision_fkey"
  FOREIGN KEY ("id", "current_composition_revision")
  REFERENCES "graph_compositions"("graph_id", "revision")
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "subgraphs"
  ADD CONSTRAINT "subgraphs_revision_fkey"
  FOREIGN KEY ("id", "revision")
  REFERENCES "subgraph_revisions"("subgraph_id", "revision")
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "graph_composition_subgraphs"
  ADD CONSTRAINT "graph_composition_subgraphs_revision_fkey"
  FOREIGN KEY ("subgraph_id", "subgraph_revision")
  REFERENCES "subgraph_revisions"("subgraph_id", "revision")
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "graph_composition_subgraphs"
  ADD CONSTRAINT "graph_composition_subgraphs_schema_revision_fkey"
  FOREIGN KEY ("subgraph_id", "subgraph_schema_revision")
  REFERENCES "subgraph_schema_revisions"("subgraph_id", "revision")
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "graph_composition_subgraphs"
  ADD CONSTRAINT "graph_composition_subgraphs_composition_fkey"
  FOREIGN KEY ("graph_id", "composition_revision")
  REFERENCES "graph_compositions"("graph_id", "revision")
  DEFERRABLE INITIALLY DEFERRED;
