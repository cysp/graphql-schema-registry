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

ALTER TABLE "subgraphs"
  ADD CONSTRAINT "subgraphs_current_schema_revision_fkey"
  FOREIGN KEY ("id", "current_schema_revision")
  REFERENCES "subgraph_schema_revisions"("subgraph_id", "revision")
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "graphs"
  ADD CONSTRAINT "graphs_current_graph_composition_revision_fkey"
  FOREIGN KEY ("id", "current_graph_composition_revision")
  REFERENCES "graph_compositions"("graph_id", "revision")
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "graph_composition_graph_revisions"
  ADD CONSTRAINT "graph_composition_graph_revisions_supergraph_fkey"
  FOREIGN KEY ("graph_id", "supergraph_revision")
  REFERENCES "graph_compositions"("graph_id", "revision")
  ON DELETE CASCADE;

ALTER TABLE "graph_composition_graph_revisions"
  ADD CONSTRAINT "graph_composition_graph_revisions_graph_revision_fkey"
  FOREIGN KEY ("graph_id", "graph_revision")
  REFERENCES "graph_revisions"("graph_id", "revision");

ALTER TABLE "graph_composition_subgraph_revisions"
  ADD CONSTRAINT "graph_composition_subgraph_revisions_supergraph_fkey"
  FOREIGN KEY ("graph_id", "supergraph_revision")
  REFERENCES "graph_compositions"("graph_id", "revision")
  ON DELETE CASCADE;

ALTER TABLE "graph_composition_subgraph_revisions"
  ADD CONSTRAINT "graph_composition_subgraph_revisions_subgraph_revision_fkey"
  FOREIGN KEY ("subgraph_id", "subgraph_revision")
  REFERENCES "subgraph_revisions"("subgraph_id", "revision");

ALTER TABLE "graph_composition_subgraph_schema_revisions"
  ADD CONSTRAINT "graph_composition_subgraph_schema_revisions_supergraph_fkey"
  FOREIGN KEY ("graph_id", "supergraph_revision")
  REFERENCES "graph_compositions"("graph_id", "revision")
  ON DELETE CASCADE;

ALTER TABLE "graph_composition_subgraph_schema_revisions"
  ADD CONSTRAINT "graph_composition_subgraph_schema_revisions_ssr_fkey"
  FOREIGN KEY ("subgraph_id", "subgraph_schema_revision")
  REFERENCES "subgraph_schema_revisions"("subgraph_id", "revision");
