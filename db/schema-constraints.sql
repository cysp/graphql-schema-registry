ALTER TABLE "graphs"
  ADD CONSTRAINT "fk_g__cur_rev__gr"
  FOREIGN KEY ("id", "current_revision")
  REFERENCES "graph_revisions"("graph_id", "revision")
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "graphs"
  ADD CONSTRAINT "fk_g__cur_ssr_rev__ssr"
  FOREIGN KEY ("id", "current_supergraph_schema_revision")
  REFERENCES "supergraph_schema_revisions"("graph_id", "revision")
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "subgraphs"
  ADD CONSTRAINT "fk_sg__cur_rev__sgr"
  FOREIGN KEY ("id", "current_revision")
  REFERENCES "subgraph_revisions"("subgraph_id", "revision")
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "subgraphs"
  ADD CONSTRAINT "fk_sg__cur_sch_rev__sgsr"
  FOREIGN KEY ("id", "current_schema_revision")
  REFERENCES "subgraph_schema_revisions"("subgraph_id", "revision")
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "supergraph_schema_revision_subgraphs"
  ADD CONSTRAINT "fk_ssrs__ssr_rev__ssr"
  FOREIGN KEY ("graph_id", "supergraph_schema_revision")
  REFERENCES "supergraph_schema_revisions"("graph_id", "revision")
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "supergraph_schema_revision_subgraphs"
  ADD CONSTRAINT "fk_ssrs__sg_graph__sg"
  FOREIGN KEY ("subgraph_id", "graph_id")
  REFERENCES "subgraphs"("id", "graph_id")
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "supergraph_schema_revision_subgraphs"
  ADD CONSTRAINT "fk_ssrs__sg_rev__sgr"
  FOREIGN KEY ("subgraph_id", "subgraph_revision")
  REFERENCES "subgraph_revisions"("subgraph_id", "revision")
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "supergraph_schema_revision_subgraphs"
  ADD CONSTRAINT "fk_ssrs__sg_sch_rev__sgsr"
  FOREIGN KEY ("subgraph_id", "subgraph_schema_revision")
  REFERENCES "subgraph_schema_revisions"("subgraph_id", "revision")
  DEFERRABLE INITIALLY DEFERRED;
